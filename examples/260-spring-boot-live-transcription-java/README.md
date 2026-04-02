# Spring Boot Real-Time Transcription with Deepgram

A Spring Boot 3 application that provides a WebSocket endpoint for real-time audio transcription using Deepgram's live STT API (Nova-3). Clients connect via WebSocket, send audio data, and receive live transcription results streamed back in real time.

## What you'll build

A Java Spring Boot server that accepts browser WebSocket connections, proxies raw audio to Deepgram's live STT WebSocket, and streams transcription results back to the client. Includes a built-in HTML test page for browser-based microphone capture.

## Prerequisites

- Java 17+
- Maven 3.9+ (or use the included Maven wrapper)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) → Settings → API Keys |

## Install and run

```bash
cp .env.example .env
# Edit .env and add your DEEPGRAM_API_KEY

export $(grep -v '^#' .env | xargs)
./mvnw spring-boot:run
```

Then open [http://localhost:8080](http://localhost:8080) in your browser, click **Start**, and speak into your microphone.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's highest-accuracy transcription model |
| `smartFormat` | `true` | Formats numbers, dates, currencies automatically |
| `interimResults` | `true` | Returns partial results as audio streams in |
| `tag` | `deepgram-examples` | Tags API usage for Deepgram console analytics |

## How it works

1. Browser opens a WebSocket connection to `/ws/transcribe`
2. Spring Boot handler opens a corresponding Deepgram live STT WebSocket (Nova-3)
3. Browser captures microphone audio via `getUserMedia`, converts to 16-bit PCM, and sends binary frames
4. Handler forwards raw audio bytes to Deepgram in real time
5. Deepgram returns interim and final transcription results
6. Handler forwards transcript JSON back to the browser
7. On disconnect, handler sends `CloseStream` to Deepgram and cleans up

## Health check

Spring Boot Actuator exposes a health endpoint at `GET /actuator/health`.

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
