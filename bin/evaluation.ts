#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EvaluationStack } from '../lib/evaluation-stack';

const app = new cdk.App();
new EvaluationStack(app, 'EvalStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});
