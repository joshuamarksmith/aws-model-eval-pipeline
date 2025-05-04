import {
  BedrockRuntimeClient,
  InvokeModelCommand
} from '@aws-sdk/client-bedrock-runtime';

const candidateClient = new BedrockRuntimeClient({});
const judgeClient     = new BedrockRuntimeClient({});

interface Case {
  prompt: string;
  reference: string;
}
const cases: Case[] = [
  {
    prompt: 'Explain the difference between Tier 1 and Tier 2 capital.',
    reference:
      'Tier 1 capital consists primarily of common equity and disclosed reserves; Tier 2 includes subordinated debt, hybrid instruments, and loan‑loss reserves.'
  },
  {
    prompt: 'What triggers a SAR filing under the Bank Secrecy Act?',
    reference:
      'Any transaction of $5 000 or more that the institution knows, suspects, or has reason to suspect involves funds derived from illegal activity, is designed to evade regulations, or has no lawful purpose.'
  },
  {
    prompt: 'State the Volcker Rule’s main limitation on proprietary trading.',
    reference:
      'It generally prohibits banking entities from engaging in short‑term proprietary trading of securities, derivatives, and certain other instruments for the firm’s own account.'
  },
  {
    prompt: 'Describe the purpose of the Net Stable Funding Ratio.',
    reference:
      'NSFR ensures banks maintain a stable funding profile in relation to the composition of their assets and off‑balance‑sheet activities over a one‑year horizon.'
  },
  {
    prompt: 'Define “beneficial ownership” under FinCEN’s CDD rule.',
    reference:
      'Each legal‑entity customer must disclose any individual who owns 25 % or more of the equity interests and one individual with significant managerial control.'
  }
];

const JUDGE_MODEL = 'anthropic.claude-3-opus-20240229';
const PASSING_AVG = 0.75;            // ≥ 3 / 4 on 1‑4 rubric

export const handler = async (event: any) => {
  const detail = event.detail ?? {};
  const candidateModel = detail.modelId ?? 'anthropic.claude-sonnet-3.7';

  let totalScore = 0;

  for (const { prompt, reference } of cases) {
    /* 1. get candidate answer */
    const candResp: any = await candidateClient.send(
      new InvokeModelCommand({
        modelId: candidateModel,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ prompt, max_tokens_to_sample: 192 })
      })
    );
    const candidateAnswer = JSON.parse(
      new TextDecoder().decode(candResp.body)
    ).completion;

    /* 2. let judge model grade it */
    const judgePrompt = `
You are an expert grader.  The candidate answer should be compared to the reference answer.
Give ONLY a JSON object with keys:
- "score" (integer 1‑4 where 4 = fully correct)
Do not output any other text.

Question: ${prompt}
Reference answer: ${reference}
Candidate answer: ${candidateAnswer}
`;
    const judgeResp: any = await judgeClient.send(
      new InvokeModelCommand({
        modelId: JUDGE_MODEL,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ prompt: judgePrompt, max_tokens_to_sample: 32 })
      })
    );
    const parsed = JSON.parse(
      new TextDecoder().decode(judgeResp.body)
    ).completion;
    totalScore += parsed.score ?? 0;
  }

  const avg = totalScore / (cases.length * 4); // normalise 0‑1
  return { check: 'LLMJudge', score: avg, passed: avg >= PASSING_AVG };
};
