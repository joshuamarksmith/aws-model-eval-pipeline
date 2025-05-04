# Model‑Evaluation Pipeline (Left‑Side Stack)
_Automated offline vetting & approval of LLM candidates before API‑Gateway deployment_

---

## Table of Contents
1. [Why this stack exists](#why-this-stack-exists)
2. [High‑level architecture](#high-level-architecture)
3. [Repository layout](#repository-layout)
4. [Prerequisites](#prerequisites)
5. [Deploying](#deploying)
6. [Triggering an evaluation](#triggering-an-evaluation)
7. [Outputs & hand‑off to the Deployment stack](#outputs--hand-off)
8. [Environment variables & CDK context keys](#environment-variables--cdk-context)
9. [Extending / production‑hardening](#extending--production-hardening)
10. [Troubleshooting & common gotchas](#troubleshooting--common-gotchas)

---

## Why this stack exists
Regulated industries need an **audit‑ready gate** between “new model release” and “serving live traffic.”  
This stack provides that gate by running six independent evaluations on every new or updated model:

| Capability | Implementation |
|------------|----------------|
| **Quantitative benchmark** | `LatencyP95Fn` measures P95 latency across ten invocations and fails if it exceeds the SLA. |
| **Qualitative benchmark (LLM‑as‑Judge)** | `LLMJudgeFn` calls a judge model (Claude 3 Opus) to grade candidate answers on a 1‑4 rubric. |
| **Domain & safety guardrails** | Four Lambdas—`FactualAccuracy`, `RegulatoryCitations`, `FairLending`, `PrivacyCompliance`. |
| **Orchestration & lineage** | AWS Step Functions plus a DynamoDB table store every run, score, and verdict. |
| **Event‑based hand‑off** | EventBridge emits `ModelApproved`; the Deployment stack consumes the event and flips API Gateway weights. |

Pass **all six** checks → the model is promoted; otherwise it is rejected with a full audit trail.

---

## High‑level architecture
```text
EventBridge (shared "ModelOpsBus")
   │               ▲
   │  NewModelVersion / ModelApproved events
   ▼               │
┌──────────┐   ┌─────────────────────┐
│ Rule     ├──►│  Step Functions     │
└──────────┘   │  Parallel "Evals"   │
               │  ├── LatencyP95Fn   │───► DynamoDB test lineage
               │  ├── LLMJudgeFn     │
               │  ├── FactualFn      │
               │  ├── RegulatoryFn   │
               │  ├── FairLendingFn  │
               │  └── PrivacyFn      │
               └─────────────────────┘
```

---

## Repository layout
```text
model-eval-pipeline/
├── bin/evaluation.ts             # CDK entry‑point
├── lib/evaluation-stack.ts       # Core infrastructure
├── lambda/                       # 6 evaluation handlers
│   ├── eval-factual/index.ts
│   ├── eval-regulatory/index.ts
│   ├── eval-fairlending/index.ts
│   ├── eval-privacy/index.ts
│   ├── eval-latency/index.ts
│   └── eval-qualitative/index.ts
├── package.json                  # CDK + AWS SDK dependencies
├── tsconfig.json
└── cdk.json
```

---

## Prerequisites
| Tool | Minimum version |
|------|-----------------|
| **Node.js** | 18 LTS |
| **AWS CDK** | 2.139.0 |
| **AWS CLI** | 2.15+ |
| IAM perms   | `cdk bootstrap`, `bedrock:InvokeModel`, CloudWatch, EventBridge, SSM |

```bash
npm i -g aws-cdk@latest
cdk bootstrap aws://$ACCOUNT/$REGION
git clone https://github.com/your-org/model-eval-pipeline.git
cd model-eval-pipeline
npm install
```

---

## Deploying

```bash
# Default: creates its own EventBridge bus named ModelOpsBus
cdk deploy EvalStack

# If the right‑side Deployment stack already owns a bus, pass its ARN:
cdk deploy EvalStack -c rightStackBusArn=arn:aws:events:us-east-1:123456789012:event-bus/SharedBus
```

Deployment takes ~90 s. **CDK outputs**:

| Output | Meaning |
|--------|---------|
| `EvalStateMachineArn` | Invoke manually for ad‑hoc runs. |
| `TestDatasetBucketName` | Upload JSON/CSV prompt suites here (optional). |
| `ModelOpsBusArn` | The bus both stacks share. |

---

## Triggering an evaluation

### 1 . Via EventBridge (preferred)
Until Bedrock emits model‑version events, simulate one:

```bash
aws events put-events --entries '[
  {
    "Source":"bedrock.model",
    "DetailType":"NewModelVersion",
    "Detail":"{\"modelId\":\"anthropic.claude-sonnet-3.7\",\"version\":\"2025-04-30\"}",
    "EventBusName":"<ModelOpsBusArn>"
  }
]'
```

### 2 . Direct Step Functions execution (ad‑hoc)

```bash
aws stepfunctions start-execution \
  --state-machine-arn $EvalStateMachineArn \
  --input '{"detail":{"modelId":"anthropic.claude-sonnet-3.7","version":"manual"}}'
```

---

## Outputs & hand‑off  <a id="outputs--hand-off"></a>
| Artifact | Consumer | Description |
|----------|----------|-------------|
| **EventBridge event** `Source=llmops.evaluator`, `DetailType=ModelApproved` | Deployment stack | Triggers API Gateway weighted shift. |
| **SSM param** `/modelops/approved/current` | Dashboards / infra | Holds latest approved `{ modelId, version }`. |
| **DynamoDB EvalMetadata** | Audit / BI | Stores `runId`, scores, timestamps, pass/fail. |
| **CloudWatch Logs & X‑Ray** | Ops / Sec | Full execution trace of each evaluator. |

---

## Environment variables & CDK context  <a id="environment-variables--cdk-context"></a>
| Variable | Set on | Purpose |
|----------|--------|---------|
| `DATASET_BUCKET` | every evaluator | S3 bucket for optional prompt files. |
| `TABLE_NAME` | result‑aggregator | DynamoDB lineage storage. |
| `EVENT_BUS_ARN` | result‑aggregator | Where to publish `ModelApproved`. |
| `rightStackBusArn` (CDK context) | `cdk deploy -c` | Re‑use an existing EventBridge bus instead of creating one. |

---

## Extending / production‑hardening  <a id="extending--production-hardening"></a>
| Area | Recommendation |
|------|----------------|
| **Prompt management** | Store test cases in S3 (JSON/CSV) and load dynamically. |
| **Concurrency** | Wrap each evaluator in a `Map` state with `maxConcurrency` to parallelise > 100 prompts. |
| **Judge model** | Replace public Claude 3 Opus with a private eval model. |
| **Security** | Restrict `bedrock:InvokeModel` to specific ARNs; enable SSE‑KMS and X‑Ray. |
| **Cost control** | Lower sample counts in `LatencyP95Fn`; use streaming. |
| **Failure alarms** | CloudWatch alarm on `EvalStateMachine FAILED`. |
| **CI/CD** | Integrate `cdk synth` + unit tests in pipeline. |

---

## Troubleshooting & common gotchas  <a id="troubleshooting--common-gotchas"></a>
| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| **State machine fails with `States.TaskFailed`** | Lambda timeout or Bedrock permission | • Increase `timeout` in `mkFn()`.<br>• Ensure IAM role has `bedrock:InvokeModel`. |
| **`ModelApproved` not received by Deployment stack** | Bus mismatch | Verify both stacks use the same EventBridge bus ARN. |
| **Latency check always fails** | SLA too strict for region | Adjust `MAX_P95_MS` in `eval-latency/index.ts`. |
| **CDK deploy hangs at Lambda bundling** | `esbuild` memory exhaustion | `export ESBUILD_BINARY_PATH=$(which esbuild)` or pre‑build locally then `cdk deploy --no-asset-metadata`. |

---

### Questions?
Contact jsmithac@ or virpadte@