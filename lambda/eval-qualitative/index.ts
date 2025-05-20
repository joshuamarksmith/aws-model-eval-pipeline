import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { wrapPrompt } from '../../layer/prompt-utils/nodejs/node_modules/prompt-utils';

const candClient  = new BedrockRuntimeClient({});
const judgeClient = new BedrockRuntimeClient({});
const CASES = [
  { q: 'Explain Tier 1 vs Tier 2 capital.',       ref: 'Tier 1 = common equity; Tier 2 = subordinated debt & reserves.' },
  { q: 'When must banks file a SAR?',              ref: 'Any $5k+ suspect transaction within 30 days.' },
  { q: 'State the Volcker Rule limitation.',       ref: 'Prohibits short-term proprietary trading by banking entities.' },
  { q: 'Purpose of Net Stable Funding Ratio?',     ref: 'Ensures stable funding vs asset/liability mix.' },
  { q: 'Define beneficial ownership under CDD.',   ref: '25%+ equity owners & one managerial control person.' }
];
const PASS_AVG = 0.75;

export const handler = async (event: any) => {
  console.log('▶️ Raw event:', JSON.stringify(event));
  const detail       = event.detail ?? {};
  const candidateId  = detail.modelId ?? process.env.DEFAULT_MODEL_ID!;
  const judgeModelId = process.env.JUDGE_MODEL_ID!;
  console.log(`🔍 LLM-as-Judge; candidate=${candidateId} judge=${judgeModelId}`);

  let totalScore = 0;
  for (const { q, ref } of CASES) {
    // 1) Candidate answer
    const candPrompt = await wrapPrompt(candidateId, q);
    const candRes: any = await candClient.send(new InvokeModelCommand({
      modelId: candidateId,
      contentType: 'application/json',
      accept:      'application/json',
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '' },
          { role: 'user',   content: candPrompt }
        ],
        max_tokens_to_sample: 128
      })
    }));
    const candAns = JSON.parse(new TextDecoder().decode(candRes.body)).completion;

    // 2) Judge prompt
    const judgePrompt = 
      `Compare the candidate’s answer to the reference and score 1–4.\n` +
      `Question: ${q}\nReference: ${ref}\nCandidate: ${candAns}`;
    const judgeRes: any = await judgeClient.send(new InvokeModelCommand({
      modelId: judgeModelId,
      contentType: 'application/json',
      accept:      'application/json',
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '' },
          { role: 'user',   content: judgePrompt }
        ],
        max_tokens_to_sample: 32
      })
    }));
    const { score } = JSON.parse(new TextDecoder().decode(judgeRes.body)).completion;
    totalScore += score;
  }

  const avg = totalScore / (CASES.length * 4);
  return { check: 'LLMJudge', score: avg, passed: avg >= PASS_AVG };
};
