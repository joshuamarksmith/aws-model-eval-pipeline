import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { wrapPrompt } from 'prompt-utils';

/*
 * This is a simple factual accuracy evaluation.
 */

const client = new BedrockRuntimeClient({});
const qs = [
  'As of March 2025, what is the Federal Reserve’s reserve requirement ratio for transaction accounts under Regulation D, and how is it calculated on a daily vs. average-daily basis?',
  'Define Tier 1 capital under Basel III and list the two primary components that qualify, with a brief explanation of why each is included.',
  'Summarize the timeline and key milestones in the global transition from LIBOR to SOFR, including the role of the Alternative Reference Rates Committee (ARRC).',
  'What is the maximum amount of deposit insurance coverage provided by the FDIC per depositor, per insured bank, and what types of accounts are covered vs. excluded?',
  'In which year was the Dodd-Frank Wall Street Reform and Consumer Protection Act signed into law, and name two major provisions introduced to limit systemic risk.'
];
const THRESHOLD = 0.8;

export const handler = async (event: any) => {
  console.log('▶️ Raw event:', JSON.stringify(event));
  const detail  = event.detail ?? {};
  const modelId = detail.modelId ?? process.env.DEFAULT_MODEL_ID!;
  console.log(`🔍 Invoking model: ${modelId}`);

  let correct = 0;
  for (const rawQ of qs) {
    const prompt = await wrapPrompt(modelId, rawQ);
    const body   = JSON.stringify({ prompt, max_tokens_to_sample: 256 });
    const res: any = await client.send(
      new InvokeModelCommand({ modelId, contentType: 'application/json', accept: 'application/json', body })
    );
    const answer = JSON.parse(new TextDecoder().decode(res.body)).completion.toLowerCase();

    if (
      (rawQ.includes('reserve requirement') && /\d+(\.\d+)?%/.test(answer)) ||
      (rawQ.includes('Tier 1 capital')       && answer.includes('common equity')) ||
      (rawQ.includes('LIBOR to SOFR')         && answer.includes('alternative reference rates committee')) ||
      (rawQ.includes('FDIC')                  && answer.includes('250,000')) ||
      (rawQ.includes('Dodd-Frank')            && answer.includes('2010'))
    ) {
      correct++;
    }
  }

  const score = correct / qs.length;
  return { check: 'FactualAccuracy', score, passed: score >= THRESHOLD };
};
