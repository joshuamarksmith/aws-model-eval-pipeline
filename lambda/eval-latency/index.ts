import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

/*
 Why do we use Lambdas for this?
 
 * Looping & aggregation logic (P95 latency, averaging judge scores) is much simpler in code than 
   stitching together Map+IntrinsicMath+Choice states.

 * JSON parsing of the Bedrock response and extracting fields is trivial in a few lines of TypeScript. 
   In Step Functions you’d need extra Pass states, ResultSelector s and Intrinsic functions, which quickly becomes hard to maintain.

 * Reusability: by centralizing your logic in Lambdas, you can unit-test them in isolation, 
   add richer error handling, and share libraries (e.g. wrapPrompt) without copying DSL snippets across state machines.
 */ 

const client = new BedrockRuntimeClient({});
const SAMPLE = 'Summarize the impact of Basel III on global capital markets in one sentence.';
const RUNS   = 10;
const SLA_MS = 1200;

export const handler = async (event: any) => {
  console.log('▶️ Raw event:', JSON.stringify(event));
  const detail  = event.detail ?? {};
  const modelId = detail.modelId ?? process.env.DEFAULT_MODEL_ID!;
  console.log(`🔍 Measuring latency for model: ${modelId}`);

  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = Date.now();
    await client.send(new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ prompt: SAMPLE, max_tokens_to_sample: 32 })
    }));
    times.push(Date.now() - start);
  }

  times.sort((a, b) => a - b);
  const p95    = times[Math.floor(0.95 * times.length)];
  const passed = p95 <= SLA_MS;
  return { check: 'LatencyP95', score: p95, passed };
};
