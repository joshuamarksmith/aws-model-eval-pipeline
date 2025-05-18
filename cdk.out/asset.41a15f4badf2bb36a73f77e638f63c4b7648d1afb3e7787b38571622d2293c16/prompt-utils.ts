import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

let cachedRules: { match: RegExp; prefix: string; suffix: string }[] | null = null;

async function loadRules() {
  if (cachedRules) return cachedRules;

  // SSM param holds {"bucket":"...","key":"..."}
  const ssm = new SSMClient({});
  const p = await ssm.send(
    new GetParameterCommand({ Name: "/modelops/prompt-wrappers/version" })
  );
  const { bucket, key } = JSON.parse(p.Parameter!.Value!);

  const s3 = new S3Client({});
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const json = JSON.parse(await obj.Body!.transformToString());

  cachedRules = json.rules.map((r: any) => ({
    match: new RegExp(r.match),
    prefix: r.prefix,
    suffix: r.suffix,
  }));
  return cachedRules;
}

export async function wrapPrompt(modelId: string, text: string): Promise<string> {
  const rules = await loadRules();
  if (!rules) {
    throw new Error("Failed to load rules.");
  }
  const rule = rules.find((r) => r.match.test(modelId));
  if (!rule) {
    throw new Error(`No matching rule found for modelId: ${modelId}`);
  }
  return `${rule.prefix}${text}${rule.suffix}`;
}
