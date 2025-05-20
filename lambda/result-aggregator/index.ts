import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { SSMClient, PutParameterCommand } from "@aws-sdk/client-ssm";
import { randomUUID } from "crypto";

const ddb = new DynamoDBClient({});
const eb  = new EventBridgeClient({});
const ssm = new SSMClient({});

export const handler = async (event: any) => {
  console.log("▶️ Aggregator input:", JSON.stringify(event));

  // Normalize the results array:
  // If event is already an array of {check,score,passed}, use it.
  // Otherwise look for event.results.
  let results: any[];
  if (Array.isArray(event)) {
    results = event;
  } else if (Array.isArray(event.results)) {
    results = event.results;
  } else {
    throw new Error("Aggregator: could not find results array in input");
  }

  // Generate or propagate a runId
  const runId = typeof event.runId === "string" ? event.runId : randomUUID();
  const ts = Date.now().toString();
  const approved = results.every(r => r.passed === true);

  // 1) Write to DynamoDB
  await ddb.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME!,
      Item: {
        runId:     { S: runId },
        timestamp: { N: ts },
        approved:  { BOOL: approved },
        results:   { S: JSON.stringify(results) }
      }
    })
  );

  // 2) If approved, emit ModelApproved event and update SSM
  if (approved) {
    const detailPayload = { runId, results };
    // 2a) EventBridge
    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: process.env.EVENT_BUS_ARN!,
            Source:       "llmops.evaluator",
            DetailType:   "ModelApproved",
            Detail:       JSON.stringify(detailPayload),
          },
        ],
      })
    );
    // 2b) SSM pointer
    await ssm.send(
      new PutParameterCommand({
        Name:      "/modelops/approved/current",
        Type:      "String",
        Overwrite: true,
        Value:     JSON.stringify(detailPayload),
      })
    );
  }

  // Return minimal info
  return { runId, approved };
};
