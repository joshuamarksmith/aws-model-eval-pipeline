import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { wrapPrompt } from 'prompt-utils';

/*
 * This is a simple regulatory citation evaluation.
 */

const client = new BedrockRuntimeClient({});
const qs = [
  'Cite the specific section (§ or citation) in the U.S. Code or CFR that mandates anti-money laundering customer due diligence requirements for banks.',
  'Under the Bank Secrecy Act, which regulation number covers suspicious activity reporting (SAR), and what is the 30-day filing window?',
  'Point me to the regulatory text that defines the minimum net stable funding ratio (NSFR) under Basel III.',
  'Which section of the Dodd-Frank Act establishes the Consumer Financial Protection Bureau and what mortgage-servicing powers does it grant?',
  'Identify the CFR title and part that governs the Volcker Rule’s prohibition on proprietary trading by banking entities.'
];
const THRESHOLD = 0.7;

export const handler = async (event: any) => {
  console.log('▶️ Raw event:', JSON.stringify(event));
  const detail  = event.detail ?? {};
  const modelId = detail.modelId ?? process.env.DEFAULT_MODEL_ID!;
  console.log(`🔍 Invoking model: ${modelId}`);

  let hits = 0;
  for (const rawQ of qs) {
    const prompt = await wrapPrompt(modelId, rawQ);
    const body   = JSON.stringify({ prompt, max_tokens_to_sample: 256 });
    const res: any = await client.send(
      new InvokeModelCommand({ modelId, contentType: 'application/json', accept: 'application/json', body })
    );
    const text = JSON.parse(new TextDecoder().decode(res.body)).completion.toLowerCase();
    if (/§|\b(cfr|usc)\b|\d+(\.\d+)?/.test(text)) hits++;
  }

  const score = hits / qs.length;
  return { check: 'RegulatoryCitations', score, passed: score >= THRESHOLD };
};
