#!/bin/bash
# Runs inside LocalStack container on startup to create resources

REGION="ap-south-1"
ENDPOINT="http://localhost:4566"

echo "Creating DynamoDB tables..."

awslocal dynamodb create-table \
  --table-name AudioStudio_Meetings \
  --attribute-definitions AttributeName=meetingId,AttributeType=S \
  --key-schema AttributeName=meetingId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION

awslocal dynamodb create-table \
  --table-name AudioStudio_Sessions \
  --attribute-definitions \
    AttributeName=meetingId,AttributeType=S \
    AttributeName=sessionId,AttributeType=S \
    AttributeName=userId,AttributeType=S \
    AttributeName=socketId,AttributeType=S \
    AttributeName=joinedAt,AttributeType=S \
  --key-schema \
    AttributeName=meetingId,KeyType=HASH \
    AttributeName=sessionId,KeyType=RANGE \
  --global-secondary-indexes \
    '[
      {"IndexName":"UserIndex","KeySchema":[{"AttributeName":"userId","KeyType":"HASH"},{"AttributeName":"joinedAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},
      {"IndexName":"SocketIndex","KeySchema":[{"AttributeName":"socketId","KeyType":"HASH"},{"AttributeName":"joinedAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}
    ]' \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION

awslocal dynamodb create-table \
  --table-name AudioStudio_Recordings \
  --attribute-definitions \
    AttributeName=meetingId,AttributeType=S \
    AttributeName=recordingId,AttributeType=S \
    AttributeName=uploadId,AttributeType=S \
  --key-schema \
    AttributeName=meetingId,KeyType=HASH \
    AttributeName=recordingId,KeyType=RANGE \
  --global-secondary-indexes \
    '[
      {"IndexName":"UploadIndex","KeySchema":[{"AttributeName":"uploadId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}
    ]' \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION

awslocal dynamodb create-table \
  --table-name AudioStudio_RecordingState \
  --attribute-definitions AttributeName=meetingId,AttributeType=S \
  --key-schema AttributeName=meetingId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION

awslocal dynamodb create-table \
  --table-name AudioStudio_GlobalStats \
  --attribute-definitions AttributeName=statKey,AttributeType=S \
  --key-schema AttributeName=statKey,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION

echo "Creating S3 bucket..."
awslocal s3 mb s3://audio-studio-recordings --region $REGION

echo "Creating SQS queues..."
awslocal sqs create-queue \
  --queue-name AudioStudio_Processing.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false \
  --region $REGION

awslocal sqs create-queue \
  --queue-name AudioStudio_ProcessingResults \
  --region $REGION

echo "LocalStack initialization complete!"
