import {
  aws_events as events,
  aws_events_targets as targets,
  aws_s3 as s3,
  aws_dynamodb as ddb,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
  aws_lambda_nodejs as nodeLambda,
  aws_iam as iam,
  Duration,
  Stack,
  StackProps,
  RemovalPolicy
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class EvaluationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /* ──────────────────────────────────────────────
       Shared resources
    ────────────────────────────────────────────── */
    const datasetBucket = new s3.Bucket(this, 'TestDatasetBucket', {
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED
    });

    const evalTable = new ddb.Table(this, 'EvalMetadata', {
      removalPolicy: RemovalPolicy.RETAIN,
      partitionKey: { name: 'runId', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST
    });

    /* ──────────────────────────────────────────────
       EventBridge – shared bus
    ────────────────────────────────────────────── */
    const bus =
      this.node.tryGetContext('rightStackBusArn') ??
      new events.EventBus(this, 'ModelOpsBus', { eventBusName: 'ModelOpsBus' }).eventBusArn;

    const modelBus = events.EventBus.fromEventBusArn(this, 'ExternalBus', bus);

    /* ──────────────────────────────────────────────
       Lambda layer + helper to reduce dupe code
    ────────────────────────────────────────────── */
    const commonEnv = {
      DATASET_BUCKET: datasetBucket.bucketName,
      TABLE_NAME: evalTable.tableName,
      EVENT_BUS_ARN: modelBus.eventBusArn
    };

    const mkFn = (id: string, entry: string) =>
      new nodeLambda.NodejsFunction(this, id, {
        entry,
        runtime: nodeLambda.Runtime.NODEJS_18_X,
        timeout: Duration.minutes(2),
        memorySize: 512,
        environment: commonEnv,
        bundling: { minify: true, target: 'es2020' }
      });

    const testSelectorFn = mkFn('TestSuiteSelectorFn', 'lambda/test-suite-selector/index.ts');
    const factualFn = mkFn('FactualAccuracyFn', 'lambda/eval-factual/index.ts');
    const regulatoryFn = mkFn('RegulatoryCitationsFn', 'lambda/eval-regulatory/index.ts');
    const fairLendingFn = mkFn('FairLendingFn', 'lambda/eval-fairlending/index.ts');
    const privacyFn = mkFn('PrivacyComplianceFn', 'lambda/eval-privacy/index.ts');
    const aggregatorFn = mkFn('AggregatorFn', 'lambda/result-aggregator/index.ts');
    const latencyFn    = mkFn('LatencyP95Fn',   'lambda/eval-latency/index.ts');
    const llmJudgeFn   = mkFn('LLMJudgeFn',     'lambda/eval-qualitative/index.ts');

    // Permissions
    datasetBucket.grantRead(testSelectorFn, factualFn, regulatoryFn, fairLendingFn, privacyFn);
    evalTable.grantWriteData(aggregatorFn);
    [factualFn, regulatoryFn, fairLendingFn, privacyFn, latencyFn, llmJudgeFn].forEach(fn =>
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['bedrock:*InvokeModel*', 'bedrock:InvokeModel'],
          resources: ['*']
        })
      )
    );
    aggregatorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents', 'ssm:PutParameter'],
        resources: ['*'] // fine-tune to specific ARNs in prod
      })
    );

    /* ──────────────────────────────────────────────
       Step Functions definition
    ────────────────────────────────────────────── */
    const evaluateParallel = new sfn.Parallel(this, 'ParallelEvals').branch(
      new tasks.LambdaInvoke(this, 'FactualAccuracy', {
        lambdaFunction: factualFn,
        retryOnServiceExceptions: true,
        outputPath: '$.Payload'
      }),
      new tasks.LambdaInvoke(this, 'RegulatoryCitations', {
        lambdaFunction: regulatoryFn,
        outputPath: '$.Payload'
      }),
      new tasks.LambdaInvoke(this, 'FairLending', {
        lambdaFunction: fairLendingFn,
        outputPath: '$.Payload'
      }),
      new tasks.LambdaInvoke(this, 'PrivacyCompliance', {
        lambdaFunction: privacyFn,
        outputPath: '$.Payload'
      })
      new tasks.LambdaInvoke(this, 'LatencyP95', {
        lambdaFunction: latencyFn,
        outputPath: '$.Payload'
      }),
      new tasks.LambdaInvoke(this, 'LLMJudge', {
        lambdaFunction: llmJudgeFn,
        outputPath: '$.Payload'
      })
    );

    const definition = new tasks.LambdaInvoke(this, 'SelectTestSuite', {
      lambdaFunction: testSelectorFn,
      outputPath: '$.Payload'
    })
      .next(evaluateParallel)
      .next(
        new tasks.LambdaInvoke(this, 'AggregateResults', {
          lambdaFunction: aggregatorFn,
          outputPath: '$.Payload'
        })
      )
      .next(
        new sfn.Choice(this, 'Pass?')
          .when(sfn.Condition.booleanEquals('$.approved', true), new sfn.Succeed(this, 'ModelApproved'))
          .otherwise(new sfn.Fail(this, 'ModelRejected'))
      );

    const stateMachine = new sfn.StateMachine(this, 'EvalStateMachine', {
      definition,
      timeout: Duration.minutes(30),
      tracingEnabled: true
    });

    /* ──────────────────────────────────────────────
       EventBridge rule => kick-off SFN
    ────────────────────────────────────────────── */
    const rule = new events.Rule(this, 'NewModelRule', {
      eventBus: modelBus,
      eventPattern: {
        source: ['bedrock.model'],
        detailType: ['NewModelVersion']
      }
    });
    rule.addTarget(new targets.SfnStateMachine(stateMachine, { retryAttempts: 2 }));

    /* ──────────────────────────────────────────────
       Outputs
    ────────────────────────────────────────────── */
    new cdk.CfnOutput(this, 'EvalStateMachineArn', { value: stateMachine.stateMachineArn });
    new cdk.CfnOutput(this, 'TestDatasetBucketName', { value: datasetBucket.bucketName });
    new cdk.CfnOutput(this, 'ModelOpsBusArn', { value: modelBus.eventBusArn });
  }
}