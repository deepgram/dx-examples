'use strict';

require('dotenv').config();

const { ToolLoopAgent } = require('ai');
const { openai } = require('@ai-sdk/openai');
const fs = require('fs');
const path = require('path');
const { transcribeAudio, speakText } = require('./tools');

// The Vercel AI SDK's ToolLoopAgent is an agent that autonomously loops,
// calling tools until it has enough information to respond.  Here we give it
// Deepgram-powered STT and TTS tools so it can listen to audio and speak back.
//
// The agent flow:
//   1. User provides an audio URL
//   2. Agent calls transcribeAudio tool (Deepgram nova-3 via @ai-sdk/deepgram)
//   3. Agent reasons about the transcript using the LLM
//   4. Agent calls speakText tool (Deepgram Aura 2 via @ai-sdk/deepgram)
//   5. Agent returns a structured summary with the spoken response

const voiceAgent = new ToolLoopAgent({
  id: 'deepgram-voice-agent',
  // .chat() uses the Chat Completions API — compatible with all OpenAI orgs.
  // You can swap this for any AI SDK-compatible model (Anthropic, Google, etc.).
  model: openai.chat('gpt-4o-mini'),
  instructions: [
    'You are a helpful voice assistant powered by Deepgram.',
    'When given an audio URL, ALWAYS use the transcribeAudio tool first to understand what was said.',
    'After transcribing, summarise the key points and then use the speakText tool to speak your summary aloud.',
    'Always respond with both the written summary and confirmation that you spoke it.',
  ].join(' '),
  tools: { transcribeAudio, speakText },
});

async function runAgent(prompt) {
  // agent.generate() runs the full tool loop: the agent calls tools as needed
  // and returns when it has a final text response (or hits the step limit).
  return voiceAgent.generate({ prompt });
}

async function main() {
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const audioUrl =
    process.env.AUDIO_URL || 'https://dpgr.am/spacewalk.wav';

  console.log(`\nAsking the agent to transcribe and summarise: ${audioUrl}\n`);

  const result = await runAgent(
    `Please transcribe the audio at ${audioUrl}, summarise the key points, and then speak your summary aloud.`
  );

  console.log('── Agent Response ──────────────────────────────');
  console.log(result.text);
  console.log(`\n── Steps: ${result.steps.length} ──`);
  for (const step of result.steps) {
    if (step.toolCalls?.length) {
      for (const tc of step.toolCalls) {
        console.log(`  Tool: ${tc.toolName}(${JSON.stringify(tc.args).slice(0, 80)}...)`);
      }
    }
  }

  // Save any TTS audio from the speakText tool call
  const outDir = path.join(__dirname, '..', 'output');
  for (const step of result.steps) {
    for (const tr of step.toolResults || []) {
      if (tr.toolName === 'speakText' && tr.result?.audioBase64) {
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, 'agent-response.raw');
        fs.writeFileSync(outPath, Buffer.from(tr.result.audioBase64, 'base64'));
        console.log(`\nTTS audio saved to ${outPath}`);
        console.log(`  Play: ffplay -f s16le -ar 24000 -ac 1 ${outPath}`);
      }
    }
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { voiceAgent, runAgent };
