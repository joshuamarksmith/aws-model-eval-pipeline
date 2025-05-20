import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { wrapPrompt } from '../../layer/prompt-utils/nodejs/node_modules/prompt-utils';

/*
 * This is a simple qualitative evaluation of the model's ability to follow instructions.
 * It uses a simple prompt to generate a candidate answer, and then a judge model to score it.
 * The judge model is a small model that is trained to score the candidate answer.

 Why do we use Lambdas for this?
 
 * Looping & aggregation logic (P95 latency, averaging judge scores) is much simpler in code than 
   stitching together Map+IntrinsicMath+Choice states.

 * JSON parsing of the Bedrock response and extracting fields is trivial in a few lines of TypeScript. 
   In Step Functions you’d need extra Pass states, ResultSelector s and Intrinsic functions, which quickly becomes hard to maintain.

 * Reusability: by centralizing your logic in Lambdas, you can unit-test them in isolation, 
   add richer error handling, and share libraries (e.g. wrapPrompt) without copying DSL snippets across state machines.
 */  

const candClient  = new BedrockRuntimeClient({});
const judgeClient = new BedrockRuntimeClient({});
const CASES = [
  { q: 'Explain Tier 1 vs Tier 2 capital.',             ref: 'Tier 1 = common equity; Tier 2 = subordinated debt & reserves.' },
  { q: 'When must banks file a SAR?',                    ref: 'Any $5k+ suspect transaction within 30 days.' },
  { q: 'State the Volcker Rule limitation.',             ref: 'Prohibits short-term proprietary trading by banking entities.' },
  { q: 'Purpose of Net Stable Funding Ratio?',           ref: 'Ensures stable funding vs asset/liability mix.' },
  { q: 'Define beneficial ownership under CDD.',         ref: '25%+ equity owners & one managerial control person.' }
];
const PASS_AVG = 0.75;

export const handler = async (event: any) => {
  console.log('Raw event:', JSON.stringify(event));
  const detail       = event.detail ?? {};
  const candidateId  = detail.modelId ?? process.env.DEFAULT_MODEL_ID!;
  const judgeModelId = process.env.JUDGE_MODEL_ID!;
  console.log(`Judging candidate=${candidateId} with judge=${judgeModelId}`);

  let total = 0;
  for (const { q, ref } of CASES) {
    // Candidate response
    const candPrompt = await wrapPrompt(candidateId, q);
    const candCmd = new ConverseCommand({
      modelId: candidateId,
      messages: [
        { role: 'assistant', content: [{ text: '' }] },
        { role: 'user',   content: [{ text: candPrompt }] }
      ],
      inferenceConfig: {
        maxTokens: 128,
        temperature: 0,
        topP: 1.0
      }
    });
    const candRes: any = await candClient.send(candCmd);
    const candAns = candRes.output.message.content[0].text;

    // Judge response
    const judgeCmd = new ConverseCommand({
      modelId: judgeModelId,
      messages: [
        { role: 'assistant', content: [{ text: 'You are an expert grader. Return only JSON {\"score\":<1-4>}.' }] },
        { role: 'user',   content: [{ text: `Question: ${q}\nReference: ${ref}\nCandidate: ${candAns}` }] }
      ],
      inferenceConfig: {
        maxTokens: 32,
        temperature: 0,
        topP: 1.0
      }
    });
    const judgeRes: any = await judgeClient.send(judgeCmd);
    const { score } = JSON.parse(judgeRes.output.message.content[0].text);
    total += score;
  }

  const avg = total / (CASES.length * 4);
  return { check: 'LLMJudge', score: avg, passed: avg >= PASS_AVG };
};