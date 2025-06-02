import logging
import boto3
from botocore.exceptions import ClientError
from botocore.config import Config
import json
import os
import traceback

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

# Get model parameters from environment variables with defaults
MODEL_ID = os.environ.get("MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0")
TEMPERATURE = float(os.environ.get("TEMPERATURE", "0.5"))
TOP_K = int(os.environ.get("TOP_K", "200"))

# Create a boto3 client configuration with connection pooling
boto_config = Config(
    max_pool_connections=5,
    retries={"max_attempts": 3, "mode": "standard"}
)

def generate_conversation(bedrock_client, model_id, system_prompts, messages):
    """
    Sends messages to a model.
    Args:
        bedrock_client: The Boto3 Bedrock runtime client.
        model_id (str): The model ID to use.
        system_prompts (JSON) : The system prompts for the model to use.
        messages (JSON) : The messages to send to the model.

    Returns:
        response (JSON): The conversation that the model generated.
    """
    logger.info("Generating message with model %s", model_id)

    # Use environment variables for inference parameters
    inference_config = {"temperature": TEMPERATURE}
    additional_model_fields = {"top_k": TOP_K}

    # Send the message
    response = bedrock_client.converse(
        modelId=model_id,
        messages=messages,
        system=system_prompts,
        inferenceConfig=inference_config,
        additionalModelRequestFields=additional_model_fields
    )

    # Log token usage
    token_usage = response['usage']
    logger.info("Input tokens: %s, Output tokens: %s, Total tokens: %s, Stop reason: %s",
                token_usage['inputTokens'], token_usage['outputTokens'], 
                token_usage['totalTokens'], response['stopReason'])

    return response

def handler(event, context):
    # Initialize the client inside the handler for better container reuse
    bedrock_client = boto3.client("bedrock-runtime", config=boto_config)
    
    try:
        # Parse and validate input
        body = json.loads(event.get("body") or "{}")
        prompt = body.get("prompt")

        if not prompt or not isinstance(prompt, str) or not prompt.strip():
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing or invalid 'prompt' in request body"}),
                "headers": {"Content-Type": "application/json"}
            }

        # Check prompt length (rough estimate)
        if len(prompt) > 100000:  # Arbitrary limit, adjust based on your needs
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Prompt exceeds maximum length"}),
                "headers": {"Content-Type": "application/json"}
            }

        # Prepare message
        message = {
            "role": "user",
            "content": [{"text": prompt}]
        }
        
        # Generate response
        response = generate_conversation(
            bedrock_client, MODEL_ID, [], [message])

        # Return properly serialized response
        return {
            "statusCode": 200,
            "body": json.dumps(response['output']['message']),
            "headers": {"Content-Type": "application/json"}
        }

    except ClientError as e:
        logger.error("Bedrock client error: %s", str(e))
        return {
            "statusCode": 500,
            "body": json.dumps({"error": f"Bedrock service error: {str(e)}"}),
            "headers": {"Content-Type": "application/json"}
        }
    except json.JSONDecodeError as e:
        logger.error("JSON parsing error: %s", str(e))
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "Invalid JSON in request body"}),
            "headers": {"Content-Type": "application/json"}
        }
    except Exception as e:
        logger.error("Unexpected error: %s\n%s", str(e), traceback.format_exc())
        return {
            "statusCode": 500,
            "body": json.dumps({"error": f"Internal server error: {str(e)}"}),
            "headers": {"Content-Type": "application/json"}
        }
