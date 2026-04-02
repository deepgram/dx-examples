"""AWS Lambda function that transcribes audio using Deepgram nova-3.

Accepts two input modes via API Gateway:
  1. JSON body with an S3 URL or public URL  → Deepgram fetches audio server-side
  2. Base64-encoded audio in the request body → decoded and sent as bytes

API Gateway has a 10 MB payload limit, so large files should use the S3 URL
path. Lambda's 15-minute timeout is generous for pre-recorded transcription —
most files complete in a few seconds.
"""

import base64
import json
import os

import boto3
from deepgram import DeepgramClient


def handler(event, context):
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        return _response(500, {"error": "DEEPGRAM_API_KEY not configured"})

    body = _parse_body(event)
    if "error" in body:
        return _response(400, body)

    client = DeepgramClient(api_key=api_key)

    try:
        if "url" in body:
            url = body["url"]

            # S3 pre-signed URLs and public URLs go through transcribe_url —
            # Deepgram fetches audio server-side so it never hits Lambda memory.
            if url.startswith("s3://"):
                url = _s3_to_presigned(url)

            response = client.listen.v1.media.transcribe_url(
                url=url,
                model="nova-3",
                smart_format=True,
                # ← THIS tags all traffic from examples so Deepgram can
                # separate test usage from production in the console.
                tag="deepgram-examples",
            )
        elif "audio" in body:
            # Base64-encoded audio in the request body — for small files
            # sent directly through API Gateway (up to ~6 MB after encoding).
            audio_bytes = base64.b64decode(body["audio"])
            response = client.listen.v1.media.transcribe_file(
                audio_bytes,
                model="nova-3",
                smart_format=True,
                tag="deepgram-examples",
            )
        else:
            return _response(400, {"error": "Provide 'url' or 'audio' (base64) in request body"})
    except Exception as exc:
        return _response(502, {"error": f"Transcription failed: {exc}"})

    # response.results.channels[0].alternatives[0].transcript
    alt = response.results.channels[0].alternatives[0]
    words = alt.words or []
    duration = words[-1].end if words else 0.0

    return _response(200, {
        "transcript": alt.transcript,
        "confidence": alt.confidence,
        "duration_seconds": round(duration, 2),
        "words_count": len(words),
    })


def _parse_body(event):
    """Extract JSON body from API Gateway v1 or v2 proxy event."""
    body_str = event.get("body", "")
    if not body_str:
        return {"error": "Empty request body. Send JSON with 'url' or 'audio'."}

    if event.get("isBase64Encoded"):
        body_str = base64.b64decode(body_str).decode("utf-8")

    try:
        return json.loads(body_str)
    except (json.JSONDecodeError, TypeError):
        return {"error": "Invalid JSON in request body"}


def _s3_to_presigned(s3_uri):
    """Convert s3://bucket/key to a pre-signed HTTPS URL (valid 15 min).

    Uses the Lambda execution role's permissions — the role needs
    s3:GetObject on the target bucket/prefix.
    """
    parts = s3_uri.replace("s3://", "").split("/", 1)
    bucket, key = parts[0], parts[1]
    s3 = boto3.client("s3")
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=900,
    )


def _response(status_code, body):
    """Format an API Gateway proxy integration response."""
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
