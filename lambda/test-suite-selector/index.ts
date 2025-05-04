import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { v4 as uuid } from 'uuid';

const s3 = new S3Client({});
const { DATASET_BUCKET } = process.env;

export const handler = async (event: any) => {
  const runId = uuid();
  // For demo we simply list all objects; in prod filter by model family, locale, etc.
  const objs = await s3.send(
    new ListObjectsV2Command({ Bucket: DATASET_BUCKET!, MaxKeys: 1000 })
  );
  const keys = objs.Contents?.map(o => o.Key).filter(Boolean) as string[];

  return { runId, datasetKeys: keys };
};