'use strict';

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const twilio = require('twilio');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// Deepgram Voice Agent API endpoint — bidirectional conversational AI
const DG_AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';

// Twilio sends μ-law 8 kHz mono; the Voice Agent can accept and return it directly,
// avoiding any server-side format conversion.
const AGENT_SETTINGS = {
  type: 'Settings',
  audio: {
    input: {
      encoding: 'mulaw',
      sample_rate: 8000,
    },
    output: {
      encoding: 'mulaw',
      sample_rate: 8000,
    },
  },
  agent: {
    listen: {
      provider: {
        type: 'deepgram',
        model: 'nova-3',
      },
    },
    think: {
      provider: {
        type: 'open_ai',
        model: 'gpt-4o-mini',
      },
      prompt:
        'You are a friendly phone assistant for a pizza shop called "Deepgram Pizza". ' +
        'You help customers check their order status. Keep responses concise — the caller is on the phone. ' +
        'When a customer asks about their order, use the check_order_status function to look it up.',
      functions: [
        {
          name: 'check_order_status',
          description: 'Look up the status of a pizza order by order number',
          parameters: {
            type: 'object',
            properties: {
              order_number: {
                type: 'string',
                description: 'The order number to look up, e.g. "12345"',
              },
            },
            required: ['order_number'],
          },
        },
      ],
    },
    speak: {
      provider: {
        type: 'deepgram',
        model: 'aura-2-thalia-en',
      },
    },
    greeting: 'Thanks for calling Deepgram Pizza! How can I help you today?',
  },
};

// Demo function call handler — returns canned data.
// In production you would call your real order database here.
function handleFunctionCall(name, args) {
  if (name === 'check_order_status') {
    const num = args.order_number || 'unknown';
    return JSON.stringify({
      order_number: num,
      status: 'out_for_delivery',
      estimated_arrival: '15 minutes',
      items: ['Large pepperoni pizza', 'Garlic bread'],
    });
  }
  return JSON.stringify({ error: 'Unknown function' });
}

function createApp() {
  const app = express();
  expressWs(app);

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  // POST /voice — Twilio webhook that returns TwiML to start a Media Stream
  app.post('/voice', (req, res) => {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const streamUrl = `${protocol}://${host}/media`;

    const response = new twilio.twiml.VoiceResponse();
    const connect = response.connect();
    // ← bidirectional stream lets us send agent TTS audio back to the caller
    connect.stream({ url: streamUrl });

    res.type('text/xml').send(response.toString());
    console.log(`[voice] New call → streaming to ${streamUrl}`);
  });

  // POST /outbound — Initiate an outbound call to a phone number
  app.post('/outbound', express.json(), async (req, res) => {
    const to = req.body?.to || req.query?.to;
    if (!to) return res.status(400).json({ error: 'Missing "to" phone number' });

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const host = req.headers.host;
    const voiceUrl =
      (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') +
      `://${host}/voice`;

    try {
      const call = await client.calls.create({
        to,
        from: process.env.TWILIO_PHONE_NUMBER,
        url: voiceUrl,
      });
      console.log(`[outbound] Call initiated: ${call.sid}`);
      res.json({ callSid: call.sid });
    } catch (err) {
      console.error('[outbound] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // WS /media — Twilio Media Stream ↔ Deepgram Voice Agent bridge
  app.ws('/media', (twilioWs) => {
    let agentWs = null;
    let agentReady = false;
    let streamSid = null;
    const mediaQueue = [];

    console.log('[media] Twilio WebSocket connected');

    // ── Open Deepgram Voice Agent WebSocket ─────────────────────────────
    agentWs = new WebSocket(DG_AGENT_URL, {
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
    });

    agentWs.on('open', () => {
      console.log('[agent] Connected to Deepgram Voice Agent');
      agentWs.send(JSON.stringify(AGENT_SETTINGS));
    });

    agentWs.on('message', (data, isBinary) => {
      if (isBinary) {
        // Agent TTS audio → send back to Twilio caller
        if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
          twilioWs.send(
            JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: Buffer.from(data).toString('base64') },
            }),
          );
        }
        return;
      }

      // Text-frame JSON messages from the agent
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case 'Welcome':
            console.log(`[agent] Welcome — request_id: ${msg.request_id}`);
            break;

          case 'SettingsApplied':
            console.log('[agent] Settings applied');
            agentReady = true;
            // Flush any audio that arrived before the agent was ready
            for (const payload of mediaQueue) {
              agentWs.send(Buffer.from(payload, 'base64'));
            }
            mediaQueue.length = 0;
            break;

          case 'ConversationText':
            console.log(`[${msg.role}] ${msg.content}`);
            break;

          case 'UserStartedSpeaking':
            console.log('[agent] User started speaking');
            // Clear Twilio's audio buffer so the caller hears the interruption immediately
            if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
              twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
            }
            break;

          case 'AgentThinking':
            console.log('[agent] Thinking…');
            break;

          case 'FunctionCallRequest':
            // ← THIS enables tool use: the agent asks us to run a function
            for (const fn of msg.functions || []) {
              console.log(`[function] ${fn.name}(${fn.arguments})`);
              let args = {};
              try { args = JSON.parse(fn.arguments); } catch {}
              const output = handleFunctionCall(fn.name, args);
              agentWs.send(
                JSON.stringify({ type: 'FunctionCallResponse', id: fn.id, output }),
              );
            }
            break;

          case 'AgentStartedSpeaking':
            console.log(
              `[agent] Speaking (latency: ${msg.total_latency?.toFixed(2)}s)`,
            );
            break;

          case 'AgentAudioDone':
            console.log('[agent] Audio done');
            break;

          case 'Error':
            console.error(`[agent] Error: ${msg.description} (${msg.code})`);
            break;

          case 'Warning':
            console.warn(`[agent] Warning: ${msg.description}`);
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('[agent] Failed to parse message:', err.message);
      }
    });

    agentWs.on('error', (err) => {
      console.error('[agent] WebSocket error:', err.message);
    });

    agentWs.on('close', (code, reason) => {
      console.log(`[agent] WebSocket closed (${code})`);
      agentReady = false;
    });

    // ── Handle Twilio Media Stream messages ─────────────────────────────
    twilioWs.on('message', (raw) => {
      try {
        const message = JSON.parse(raw);

        switch (message.event) {
          case 'connected':
            console.log('[twilio] Stream connected');
            break;

          case 'start':
            streamSid = message.start.streamSid;
            console.log(`[twilio] Stream started — SID: ${streamSid}`);
            break;

          case 'media':
            // Forward caller audio to Deepgram agent as raw binary
            if (agentReady && agentWs?.readyState === WebSocket.OPEN) {
              agentWs.send(Buffer.from(message.media.payload, 'base64'));
            } else {
              mediaQueue.push(message.media.payload);
            }
            break;

          case 'stop':
            console.log('[twilio] Stream stopped');
            if (agentWs?.readyState === WebSocket.OPEN) {
              agentWs.close();
            }
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('[media] Error handling message:', err.message);
      }
    });

    twilioWs.on('close', () => {
      console.log('[media] Twilio WebSocket closed');
      if (agentWs?.readyState === WebSocket.OPEN) {
        agentWs.close();
      }
    });

    twilioWs.on('error', (err) => {
      console.error('[media] Twilio WebSocket error:', err.message);
      if (agentWs?.readyState === WebSocket.OPEN) {
        agentWs.close();
      }
    });

    // Keep-alive every 8 seconds to prevent agent timeout
    const keepAlive = setInterval(() => {
      if (agentWs?.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify({ type: 'KeepAlive' }));
      } else {
        clearInterval(keepAlive);
      }
    }, 8000);

    twilioWs.on('close', () => clearInterval(keepAlive));
  });

  app.get('/', (_req, res) => {
    res.json({ status: 'ok', service: 'deepgram-twilio-voice-agent' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  POST /voice     — Twilio webhook (returns TwiML)`);
    console.log(`  POST /outbound  — Initiate outbound call`);
    console.log(`  WS   /media     — Twilio Media Stream ↔ Deepgram Agent`);
    console.log(`  GET  /          — Health check`);
  });
}

module.exports = { createApp, handleFunctionCall, AGENT_SETTINGS, DG_AGENT_URL };
