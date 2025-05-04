import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';

const ddb = new DynamoDBClient({});
const eb = new EventBridgeClient({});
const ssm = new SSMClient({});

const { TABLE_NAME, EVENT_BUS_ARN } = process.env;

interface EvalResult {
  check: string;
  score: number;
  passed: boolean;
}

export const handler = async (event: any) => {
  const { runId, datasetKeys } = event; // propagated from selector
  const results: EvalResult[] = event.Input ?? []; // Parallel output

  const approved = results.every(r => r.passed);

  await ddb.send(
    new PutItemCommand({
      TableName: TABLE_NAME!,
      Item: {
        runId: { S: runId },
        ts: { N: Date.now().toString() },
        approved: { BOOL: approved },
        results: { S: JSON.stringify(results) }
      }
    })
  );

  if (approved) {
    // fire event for Deployment stack
    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: EVENT_BUS_ARN,
            Source: 'llmops.evaluator',
            DetailType: 'ModelApproved',
            Detail: JSON.stringify(event.detail ?? {}),
          }
        ]
      })
    );

    // optional – write to SSM
    await ssm.send(
      new PutParameterCommand({
        Name: '/modelops/approved/current',
        Type: 'String',
        Overwrite: true,
        Value: JSON.stringify(event.detail ?? {})
      })
    );
  }

  return { approved };
};