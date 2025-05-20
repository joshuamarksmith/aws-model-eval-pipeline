import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

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
    // invoke as Chat API
    await client.send(new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept:      'application/json',
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '' },
          { role: 'user',   content: SAMPLE }
        ],
        max_tokens_to_sample: 32
      })
    }));
    times.push(Date.now() - start);
  }

  times.sort((a, b) => a - b);
  const p95    = times[Math.floor(0.95 * times.length)];
  const passed = p95 <= SLA_MS;
  return { check: 'LatencyP95', score: p95, passed };
};
