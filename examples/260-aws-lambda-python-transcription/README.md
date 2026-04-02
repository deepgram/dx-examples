# AWS Lambda Serverless Audio Transcription

Transcribe audio files using Deepgram nova-3 from a serverless AWS Lambda function. Deploy with a single `sam deploy` command and get an API Gateway endpoint that accepts audio URLs or base64-encoded audio and returns JSON transcripts.

## What you'll build

A Python 3.12 AWS Lambda function behind API Gateway that accepts a public audio URL (or S3 URI, or base64-encoded audio) via POST request, sends it to Deepgram's pre-recorded STT API, and returns the transcript as JSON. Includes an AWS SAM template for one-command deployment.

## Prerequisites

- Python 3.12+
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) installed
- AWS account with credentials configured (`aws configure`)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

Copy `.env.example` to `.env` and fill in your key for local testing:

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

When deploying to AWS, pass the key as a SAM parameter (stored in the Lambda environment).

## Install and run

### Local testing

```bash
pip install -r requirements.txt
python tests/test_example.py
```

### Deploy to AWS

```bash
sam build
sam deploy --guided --parameter-overrides DeepgramApiKey=YOUR_KEY_HERE
```

SAM will prompt for a stack name and region, then create the Lambda, API Gateway, and IAM role.

### Invoke the endpoint

```bash
# Transcribe from a public URL
curl -X POST https://YOUR_API_ID.execute-api.REGION.amazonaws.com/Prod/transcribe \
  -H "Content-Type: application/json" \
  -d '{"url": "https://dpgr.am/spacewalk.wav"}'

# Transcribe from an S3 URI (Lambda role needs s3:GetObject)
curl -X POST https://YOUR_API_ID.execute-api.REGION.amazonaws.com/Prod/transcribe \
  -H "Content-Type: application/json" \
  -d '{"url": "s3://my-bucket/audio/recording.wav"}'

# Transcribe base64-encoded audio (for small files < 6 MB)
curl -X POST https://YOUR_API_ID.execute-api.REGION.amazonaws.com/Prod/transcribe \
  -H "Content-Type: application/json" \
  -d "{\"audio\": \"$(base64 -w0 recording.wav)\"}"
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate STT model |
| `smart_format` | `True` | Adds punctuation, capitalisation, and number formatting |
| `tag` | `deepgram-examples` | Tags usage in the Deepgram console for tracking |

## How it works

1. API Gateway receives a POST request and invokes the Lambda function
2. The handler parses the JSON body — either a `url` string or `audio` base64 payload
3. For S3 URIs (`s3://bucket/key`), the function generates a pre-signed HTTPS URL using the Lambda execution role
4. `DeepgramClient.listen.v1.media.transcribe_url()` sends the URL to Deepgram — audio is fetched server-side and never passes through Lambda
5. For base64 audio, `transcribe_file()` sends decoded bytes directly to Deepgram
6. nova-3 with `smart_format=True` returns punctuated text with word-level timestamps
7. The handler returns transcript, confidence, duration, and word count as JSON

## Architecture

```
Client → API Gateway → Lambda → Deepgram API
                          ↕
                        S3 (optional, for large files)
```

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
