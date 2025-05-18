import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
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

const candClient         = new BedrockRuntimeClient({});
const judgeClient        = new BedrockRuntimeClient({});
const CANDIDATE_DEFAULT  = process.env.DEFAULT_MODEL_ID!;
const JUDGE_MODEL_ID     = process.env.JUDGE_MODEL_ID!;
const PASS_SCORE         = 0.75;
const CASES              = [
  { q: 'Explain Tier 1 vs Tier 2 capital.', ref: 'Tier 1 = common equity; Tier 2 = subordinated debt & reserves.' },
  { q: 'When must banks file a SAR?',       ref: 'Any $5k+ suspect transaction within 30 days.' },
  { q: 'State the Volcker Rule limitation.',ref: 'Prohibits short-term proprietary trading by banking entities.' },
  { q: 'Purpose of Net Stable Funding Ratio?', ref: 'Ensures stable funding vs asset/liability mix.' },
  { q: 'Define beneficial ownership under CDD.', ref: '25%+ equity owners & one managerial control person.' }
];

export const handler = async (event: any) => {
  const detail      = event.detail ?? {};
  const candidateId = detail.modelId ?? CANDIDATE_DEFAULT;
  console.log(`▶️ Candidate model: ${candidateId}`);

  let totalScore = 0;
  for (const { q, ref } of CASES) {
    // 1) generate candidate answer
    const candPrompt = await wrapPrompt(candidateId, q);
    const candRes: any = await candClient.send(new InvokeModelCommand({
      modelId: candidateId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ prompt: candPrompt, max_tokens_to_sample: 128 })
    }));
    const candAns = JSON.parse(new TextDecoder().decode(candRes.body)).completion;

    // 2) judge with the stronger model
    const judgePrompt = `
You are an expert grader.  Compare the candidate answer to the reference.
Provide ONLY a JSON {"score":<1–4>}.
Question: ${q}
Reference: ${ref}
Candidate: ${candAns}
`;
    const judgeRes: any = await judgeClient.send(new InvokeModelCommand({
      modelId: JUDGE_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ prompt: judgePrompt, max_tokens_to_sample: 32 })
    }));
    const { score } = JSON.parse(new TextDecoder().decode(judgeRes.body)).completion;
    totalScore += score;
  }

  const avg = totalScore / (CASES.length * 4);
  return { check: 'LLMJudge', score: avg, passed: avg >= PASS_SCORE };
};