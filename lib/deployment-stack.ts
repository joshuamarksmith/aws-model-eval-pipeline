import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { CfnOutput, Fn, RemovalPolicy } from 'aws-cdk-lib';



export class DeploymentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bedrockInferenceFunction = new lambda.Function(this, 'BedrockInferenceFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/deployment-bedrockinference'),
      timeout: cdk.Duration.minutes(10),
      memorySize: 512,
      logRetention: 1
    });


    const prodVersion = new lambda.Version(this, 'ProdVersion', {
      lambda: bedrockInferenceFunction,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const prodAlias = new lambda.Alias(this, 'ProdAlias', {
      aliasName: 'Prod',
      version: prodVersion
    });

    const restApi = new apigateway.RestApi(this, 'RestApi', {
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deploy: false,
      retainDeployments: false
    });

    const stageUri = `arn:aws:apigateway:${cdk.Aws.REGION}:lambda:path/2015-03-31/functions/${bedrockInferenceFunction.functionArn}:${prodAlias.aliasName}/invocations`;
    const integration = new apigateway.Integration({
      type: apigateway.IntegrationType.AWS_PROXY,
      integrationHttpMethod: 'POST',
      uri: stageUri
    });

    const method = restApi.root.addMethod('POST', integration);



    // Creating initial deployment
    const deployment = new apigateway.Deployment(this, 'Deployment', {
      api: restApi,
      retainDeployments: false
    });

    const prodStage = new apigateway.Stage(this, 'ProdStage', {
      deployment,
      variables: { lambdaAlias: 'Prod' }
    });

    restApi.deploymentStage = prodStage;


    [bedrockInferenceFunction, prodAlias].forEach(fn => {
      fn.addPermission(`${fn.node.id}Permission`, {
        action: 'lambda:InvokeFunction',
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: method.methodArn.replace(prodStage.stageName, '*')
      });
      fn.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'));
    });

  }
}





