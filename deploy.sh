#!/usr/bin/env bash
set -euo pipefail

# Simple deployment script for Snappy Study API (Lambda + API Gateway via CloudFormation)
# Usage:
#   # Option 1: configure via .env (recommended)
#   #   .env keys: OPENAI_API_KEY=..., REGION=eu-central-1, APP_NAME=snappy-study
#   npm run deploy
#
#   # Option 2: override via environment variables
#   REGION=eu-central-1 APP_NAME=snappy-study OPENAI_API_KEY=... npm run deploy

# Load .env if present (simple parser: KEY=VALUE, ignores comments/empty lines)
if [ -f .env ]; then
  echo "Loading environment from .env"
  # Export only lines that look like KEY=VALUE and are not commented out
  export $(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env | sed 's/#.*//') || true
fi

REGION="${REGION:-eu-central-1}"
APP_NAME="${APP_NAME:-snappy-study}"

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "ERROR: OPENAI_API_KEY environment variable is required (set it in .env or export it)" >&2
  exit 1
fi

MONTH_BUCKET="${APP_NAME}-artifacts-$(date +%Y-%m)"
RELEASE_PATH="releases/$(date +%Y/%m/%d-%H%M%S)"
ZIP_NAME="snappy-study-api.zip"
S3_KEY="${RELEASE_PATH}/${ZIP_NAME}"

echo "Region:        ${REGION}"
echo "App name:      ${APP_NAME}"
echo "Bucket:        ${MONTH_BUCKET}"
echo "Artifact key:  ${S3_KEY}"

# 1) Ensure monthly bucket exists (ignore error if it already exists)
aws s3 mb "s3://${MONTH_BUCKET}" --region "${REGION}" 2>/dev/null || echo "Bucket exists or could not be created (ok if already exists)"

# 2) Build deployment zip (Lambda code + deps)
rm -f "${ZIP_NAME}"
zip -r "${ZIP_NAME}" index.js lambda-index.js node_modules package.json > /dev/null

echo "Created archive ${ZIP_NAME}" 

# 3) Upload to S3
aws s3 cp "${ZIP_NAME}" "s3://${MONTH_BUCKET}/${S3_KEY}" --region "${REGION}"

echo "Uploaded to s3://${MONTH_BUCKET}/${S3_KEY}" 

# 4) Deploy / update CloudFormation stack
aws cloudformation deploy \
  --template-file aws/template.yaml \
  --stack-name snappy-study-api \
  --region "${REGION}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    OpenAIApiKey="${OPENAI_API_KEY}" \
    ArtifactBucket="${MONTH_BUCKET}" \
    ArtifactKey="${S3_KEY}" \
    SentryDsn="${SENTRY_DSN:-}" \
    ApiKey="${IMAGE_API_KEY:?IMAGE_API_KEY is required}"

# 5) Show API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name snappy-study-api \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

echo "Deployment complete. API endpoint: ${API_ENDPOINT}"
