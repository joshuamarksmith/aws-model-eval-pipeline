# simulate events until Bedrock emits native model-version-created events

aws events put-events --entries '[
  {
    "Source": "bedrock.model",
    "DetailType": "NewModelVersion",
    "Detail": "{\"modelId\":\"anthropic.claude-sonnet-3.7\",\"version\":\"2025-04-30\"}",
    "EventBusName": "<ModelOpsBusArn>"
  }
]'