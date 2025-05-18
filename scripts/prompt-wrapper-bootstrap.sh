# Load the prompt-wrappers.json file into S3 and update the SSM parameter

#!/usr/bin/env bash
set -euo pipefail

# Usage: ./bootstrap_prompt_wrappers.sh [AWS_REGION]
# Defaults to region in AWS CLI config if not provided.

REGION="${1:-$(aws configure get region)}"
RULES_FILE="assets/json/prompt-wrappers.json"
PREFIX="modelops-config"

# Verify AWS credentials
aws sts get-caller-identity >/dev/null

# Generate a unique bucket name
RAND=$(openssl rand -hex 6)
BUCKET="${PREFIX}-${RAND}"

echo "Creating S3 bucket: ${BUCKET} in region ${REGION}"
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

# Ensure the rules file exists
if [[ ! -f "$RULES_FILE" ]]; then
  echo "Error: Rules file not found at $RULES_FILE"
  exit 1
fi

KEY="prompt-wrappers/v1.json"
echo "Uploading ${RULES_FILE} to s3://${BUCKET}/${KEY}"
aws s3 cp "$RULES_FILE" "s3://${BUCKET}/${KEY}"

# Set or update the SSM parameter
PARAM_JSON="{\"bucket\":\"${BUCKET}\",\"key\":\"${KEY}\"}"
echo "Writing SSM parameter /modelops/prompt-wrappers/version"
aws ssm put-parameter \
  --name "/modelops/prompt-wrappers/version" \
  --type "String" \
  --overwrite \
  --value "$PARAM_JSON"

echo "Bootstrap complete."
echo "Bucket: $BUCKET"
echo "Key:    $KEY"
echo "SSM:    /modelops/prompt-wrappers/version → $PARAM_JSON"
