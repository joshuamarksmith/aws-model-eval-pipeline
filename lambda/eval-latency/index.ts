import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({});
const SAMPLE = 'Summarize the impact of Basel III on global capital markets in one sentence.';
const RUNS   = 2;
const SLA_MS = 1200;

export const handler = async (event: any) => {
  console.log('Raw event:', JSON.stringify(event));
  const detail  = event.detail ?? {};
  const modelId = detail.modelId ?? process.env.DEFAULT_MODEL_ID!;
  console.log(`Measuring latency for model: ${modelId}`);

  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = Date.now();
    const cmd = new ConverseCommand({
      modelId,
      messages: [
        { role: 'user',   content: [{ text: SAMPLE }] }
      ],
      inferenceConfig: {
        maxTokens: 32,
        temperature: 0,
        topP: 1.0
      }
    });
    await client.send(cmd);
    times.push(Date.now() - start);
  }

  times.sort((a, b) => a - b);
  const p95    = times[Math.floor(0.95 * times.length)];
  const passed = p95 <= SLA_MS;
  return { modelId, check: 'LatencyP95', score: p95, passed };
};
