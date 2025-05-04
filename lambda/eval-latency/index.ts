import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({});
const SAMPLE_PROMPT = 'Summarise the impact of Basel III on global capital markets in one paragraph.';
const RUNS = 10;
const MAX_P95_MS = 1200;          // <‑‑ tweak per SLA

export const handler = async (event: any) => {
  const detail = event.detail ?? {};
  const model = detail.modelId ?? 'anthropic.claude-sonnet-3.7';

  const durations: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = Date.now();
    await client.send(
      new InvokeModelCommand({
        modelId: model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ prompt: SAMPLE_PROMPT, max_tokens_to_sample: 64 })
      })
    );
    durations.push(Date.now() - start);
  }

  durations.sort((a, b) => a - b);
  const p95 = durations[Math.floor(0.95 * durations.length)];
  const passed = p95 <= MAX_P95_MS;
  return { check: 'LatencyP95', score: p95, passed };
};
