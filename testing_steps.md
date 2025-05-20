# Workshop Steps: Testing Your Model-Evaluation Pipeline

Follow these steps to verify and test your deployed evaluation stack. Copy‑paste each command, replacing placeholders with values from your CDK outputs.

---

## 1. Retrieve CDK Outputs

Run:

```bash
cdk output EvalStack
```

You should see keys:

* **EvalStateMachineArn**
* **ModelOpsBusArn**
* **TestDatasetBucket**
* **PromptUtilsLayerArn**

Outputs:
EvalStack.EvalStateMachineArn = arn:aws:states:us-west-2:028889494675:stateMachine:EvalStateMachine4ED22B18-wgVxUFGfGVtJ
EvalStack.ModelOpsBusArn = arn:aws:events:us-west-2:028889494675:event-bus/ModelOpsBus
EvalStack.PromptUtilsLayerArn = arn:aws:lambda:us-west-2:028889494675:layer:PromptUtilsLayer22CB464A:1
EvalStack.TestDatasetBucketName = evalstack-testdatasetbucket89e2e978-ouairrqknhod
Stack ARN:
arn:aws:cloudformation:us-west-2:028889494675:stack/EvalStack/f09af8b0-293c-11f0-87fd-0228168e91f7

Export them:

```bash
export EVAL_SM_ARN=<!-- EvalStateMachineArn value -->
export MODEL_OPS_BUS=<!-- ModelOpsBusArn value -->
export DATASET_BUCKET=<!-- TestDatasetBucket value -->
```

-------------------------------------------------------------------------------------------------------------------
|                                              ListInferenceProfiles                                              |
+---------------------------------------------------------------------------------------------------------+-------+
|                                                   Arn                                                   | Name  |
+---------------------------------------------------------------------------------------------------------+-------+
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.anthropic.claude-3-haiku-20240307-v1:0     |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.anthropic.claude-3-5-sonnet-20240620-v1:0  |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.anthropic.claude-3-sonnet-20240229-v1:0    |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.anthropic.claude-3-opus-20240229-v1:0      |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.meta.llama3-2-11b-instruct-v1:0            |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.meta.llama3-2-90b-instruct-v1:0            |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.meta.llama3-2-3b-instruct-v1:0             |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.meta.llama3-2-1b-instruct-v1:0             |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.anthropic.claude-3-5-haiku-20241022-v1:0   |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.meta.llama3-1-8b-instruct-v1:0             |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.meta.llama3-1-70b-instruct-v1:0            |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.amazon.nova-pro-v1:0                       |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.amazon.nova-lite-v1:0                      |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.amazon.nova-micro-v1:0                     |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.meta.llama3-3-70b-instruct-v1:0            |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0  |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.deepseek.r1-v1:0                           |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.mistral.pixtral-large-2502-v1:0            |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.anthropic.claude-3-7-sonnet-20250219-v1:0  |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.writer.palmyra-x4-v1:0                     |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.writer.palmyra-x5-v1:0                     |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.meta.llama4-maverick-17b-instruct-v1:0     |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.meta.llama4-scout-17b-instruct-v1:0        |  None |
|  arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.amazon.nova-premier-v1:0                   |  None |
+---------------------------------------------------------------------------------------------------------+-------+

---

## 2. Verify Prompt-Wrapper Config

Ensure the SSM pointer and S3 file exist:

```bash
# 2.1 Get SSM pointer
aws ssm get-parameter \
  --name /modelops/prompt-wrappers/version \
  --query Parameter.Value --output text

# 2.2 Check S3 JSON
# (insert bucket/key from previous output)
aws s3 cp s3://<bucket>/<key> -
```

---

## 3. Trigger an Evaluation

Check inference profiles:

```bash
aws bedrock list-inference-profiles \
  --region us-west-2 \
  --query "inferenceProfileSummaries[].{Name:name,Arn:inferenceProfileArn}" \
  --output table
```

Publish a test event to the EventBridge bus:

```bash
aws events put-events \
  --entries '[{
    "Source":"model-registry",
    "EventBusName":"ModelOpsBus",
    "DetailType":"NewCandidateModel",
    "Detail":"{\"modelId\":\"arn:aws:bedrock:us-west-2:028889494675:inference-profile/us.amazon.nova-lite-v1:0\",\"version\":\"2025-05-19\"}"
  }]'
```

---

## 4. Monitor the State Machine

**4.1** Find the latest execution ARN:

```bash
EXEC_ARN=$(aws stepfunctions list-executions \
  --state-machine-arn $EVAL_SM_ARN \
  --status-filter RUNNING \
  --query "executions[0].executionArn" --output text)
```

**4.2** Poll for status:

```bash
aws stepfunctions describe-execution \
  --execution-arn $EXEC_ARN \
  --query status --output text
```

Repeat until you see `SUCCEEDED` or `FAILED`.

---

## 5. Inspect Task Outputs

Use the execution history to view each evaluator’s result:

```bash
aws stepfunctions get-execution-history \
  --execution-arn $EXEC_ARN --output json \
  | jq -r '.events[]
    | select(.type=="TaskStateExited")
    | "- " + .stateExitedEventDetails.name + ": " + .stateExitedEventDetails.output'
```

---

## 6. Check Aggregator Decision

If the run succeeded, the aggregator wrote a `ModelApproved` event and updated SSM:

```bash
# 6.1 Read latest approved model
aws ssm get-parameter \
  --name /modelops/approved/current \
  --query Parameter.Value --output text

# 6.2 (Optional) List ModelApproved events
aws events list-archives --query "Archives[?contains(EventPattern,'ModelApproved')].Name" --output table
```

---

## 7. Tail Lambda Logs (if debugging)

List your functions:

```bash
aws lambda list-functions \
  --query "Functions[?starts_with(FunctionName,'EvalStack')].FunctionName" \
  --output text
```

Tail a specific one (e.g., Factual):

```bash
aws logs tail /aws/lambda/EvalStack-FactualFn-<hash> --follow
```

---

Congratulations—your evaluation pipeline is verified end-to-end. Adjust model IDs, thresholds, and config in SSM/S3 as needed and re-run.
