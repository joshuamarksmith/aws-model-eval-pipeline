import {
  aws_events as events,
  aws_events_targets as targets,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_s3 as s3,
  aws_dynamodb as ddb,
  aws_iam as iam,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  CfnOutput
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";

export class EvaluationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /* ── Shared resources ───────────────────────── */
    const datasetBucket = new s3.Bucket(this, "TestDatasetBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const evalTable = new ddb.Table(this, "EvalMetadata", {
      partitionKey: { name: "runId", type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const bus =
      this.node.tryGetContext("rightStackBusArn") ??
      new events.EventBus(this, "ModelOpsBus", {
        eventBusName: "ModelOpsBus",
      }).eventBusArn;
    const modelBus = events.EventBus.fromEventBusArn(this, "ExternalBus", bus);

    /* ── Prompt-utils Layer ─────────────────────── */
    const promptLayer = new lambda.LayerVersion(this, 'PromptUtilsLayer', {
      code: lambda.Code.fromAsset(
      path.join(__dirname, '..', 'layer', 'prompt-utils', 'nodejs')
      ),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: "wrapPrompt(modelId,text) helper",
    });

    const commonEnv = {
      DATASET_BUCKET: datasetBucket.bucketName,
      TABLE_NAME: evalTable.tableName,
      EVENT_BUS_ARN: modelBus.eventBusArn,
      // DEFAULT_MODEL_ID_NO_PROFILE: "amazon.nova-lite-v1:0", // override via SSM if desired
      DEFAULT_MODEL_ID: "arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.amazon.nova-lite-v1:0", // override via SSM if desired
      JUDGE_MODEL_ID: "arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.anthropic.claude-3-7-sonnet-20250219-v1:0"
    };

    /* ── Helper to create Nodejs Lambdas ─────────── */
    const mkFn = (id: string, relEntry: string) =>
      new nodejs.NodejsFunction(this, id, {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname, "..", relEntry),
        bundling: { minify: true, target: "es2020", externalModules: ['prompt-utils']},
        timeout: Duration.minutes(2),
        memorySize: 512,
        environment: commonEnv,
        layers: [promptLayer],
      });

    /* ── Evaluator Lambdas ───────────────────────── */
    const testSelectorFn = mkFn("TestSuiteSelectorFn", "lambda/test-suite-selector/index.ts");
    const factualFn      = mkFn("FactualFn", "lambda/eval-factual/index.ts");
    const regFn          = mkFn("RegFn",     "lambda/eval-regulatory/index.ts");
    const fairFn         = mkFn("FairFn",    "lambda/eval-fairlending/index.ts");
    const privFn         = mkFn("PrivFn",    "lambda/eval-privacy/index.ts");
    const latencyFn      = mkFn("LatencyFn", "lambda/eval-latency/index.ts");
    const judgeFn        = mkFn("JudgeFn",   "lambda/eval-qualitative/index.ts");
    const aggregatorFn   = mkFn("AggregatorFn", "lambda/result-aggregator/index.ts");

    /* ── Permissions ─────────────────────────────── */
    [
      testSelectorFn,
      factualFn,
      regFn,
      fairFn,
      privFn,
    ].forEach(fn => datasetBucket.grantRead(fn));

    [
      factualFn,
      regFn,
      fairFn,
      privFn,
      latencyFn,
      judgeFn,
    ].forEach(fn =>
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: ["*"],
        })
      )
    );

    evalTable.grantWriteData(aggregatorFn);
    aggregatorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["events:PutEvents", "ssm:PutParameter"],
        resources: ["*"],
      })
    );

    /* ── State machine definition ───────────────── */
    const parallel = new sfn.Parallel(this, "RunEvaluators")
      .branch(new tasks.LambdaInvoke(this, "Latency",  { lambdaFunction: latencyFn, outputPath: "$.Payload" }))
      .branch(new tasks.LambdaInvoke(this, "Judge",    { lambdaFunction: judgeFn,   outputPath: "$.Payload" }))
      .branch(new tasks.LambdaInvoke(this, "Factual",  { lambdaFunction: factualFn, outputPath: "$.Payload" }))
      .branch(new tasks.LambdaInvoke(this, "Reg",      { lambdaFunction: regFn,     outputPath: "$.Payload" }))
      .branch(new tasks.LambdaInvoke(this, "Fair",     { lambdaFunction: fairFn,    outputPath: "$.Payload" }))
      .branch(new tasks.LambdaInvoke(this, "Privacy",  { lambdaFunction: privFn,    outputPath: "$.Payload" }));

    const definition = new tasks.LambdaInvoke(this, "SelectTests", {
      lambdaFunction: testSelectorFn,
      outputPath: "$.Payload",
    })
      .next(parallel)
      .next(
        new tasks.LambdaInvoke(this, "Aggregate", {
          lambdaFunction: aggregatorFn,
          outputPath: "$.Payload",
        })
      )
      .next(
        new sfn.Choice(this, "Pass?")
          .when(sfn.Condition.booleanEquals("$.approved", true), new sfn.Succeed(this, "Approved"))
          .otherwise(new sfn.Fail(this, "Rejected"))
      );

    const sm = new sfn.StateMachine(this, "EvalStateMachine", {
      definition,
      timeout: Duration.minutes(30),
      tracingEnabled: true,
    });

    /* ── EventBridge rule ───────────────────────── */
    new events.Rule(this, "TriggerEval", {
      eventBus: modelBus,
      eventPattern: {
        source: ["bedrock.custom-model", "model-registry"],
        detailType: ["ModelImported", "NewCandidateModel"],
      },
      targets: [new targets.SfnStateMachine(sm)],
    });

    /* ── Outputs ────────────────────────────────── */
    new CfnOutput(this, "EvalStateMachineArn", { value: sm.stateMachineArn });
    new CfnOutput(this, "ModelOpsBusArn", { value: modelBus.eventBusArn });
    new CfnOutput(this, "TestDatasetBucketName", { value: datasetBucket.bucketName });
    new CfnOutput(this, "PromptUtilsLayerArn", { value: promptLayer.layerVersionArn });
  }
}
