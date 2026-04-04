'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

// ── Credential check — MUST be first ──────────────────────────────────────────
const envExample = path.join(__dirname, '..', '.env.example');
const required = fs.readFileSync(envExample, 'utf8')
  .split('\n')
  .filter(l => /^[A-Z][A-Z0-9_]+=/.test(l.trim()))
  .map(l => l.split('=')[0].trim());

const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`MISSING_CREDENTIALS: ${missing.join(',')}`);
  process.exit(2);
}
// ──────────────────────────────────────────────────────────────────────────────

const { createApp } = require('../src/server.js');

function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
    server.on('error', reject);
  });
}

async function testServerStarts() {
  console.log('Test 1: createApp() returns a configured Express app...');

  const app = createApp();
  if (typeof app !== 'function' && typeof app.listen !== 'function') {
    throw new Error('createApp() did not return an Express application');
  }

  console.log('✓ createApp() returned an Express app');
}

async function testHealthEndpoint() {
  console.log('\nTest 2: GET /health returns { status: "ok" }...');

  const app = createApp();
  const server = await startServer(app);
  const port = server.address().port;

  try {
    const resp = await fetch(`http://localhost:${port}/health`);
    const data = await resp.json();
    if (data.status !== 'ok') {
      throw new Error(`Expected { status: "ok" }, got: ${JSON.stringify(data)}`);
    }
    console.log('✓ GET /health returned { status: "ok" }');
  } finally {
    server.close();
  }
}

async function testWebhookSignatureRejection() {
  console.log('\nTest 3: POST /webhook — invalid signature returns 401...');

  const app = createApp();
  const server = await startServer(app);
  const port = server.address().port;

  try {
    const body = JSON.stringify({
      resource: 'meetingRecordings',
      event: 'ready',
      data: { id: 'fake-id' },
    });

    const resp = await fetch(`http://localhost:${port}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-spark-signature': 'invalidsignature',
      },
      body,
    });

    if (resp.status !== 401) {
      throw new Error(`Expected 401 for invalid signature, got ${resp.status}`);
    }

    const data = await resp.json();
    if (!data.error) {
      throw new Error('Expected error field in 401 response');
    }

    console.log('✓ Invalid signature correctly rejected with 401');
  } finally {
    server.close();
  }
}

async function testWebhookIgnoredEvent() {
  console.log('\nTest 4: POST /webhook — non-recording event returns ignored...');

  const app = createApp();
  const server = await startServer(app);
  const port = server.address().port;

  try {
    const body = JSON.stringify({
      resource: 'messages',
      event: 'created',
      data: { id: 'msg-123' },
    });

    const hmac = crypto
      .createHmac('sha1', process.env.WEBEX_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    const resp = await fetch(`http://localhost:${port}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-spark-signature': hmac,
      },
      body,
    });

    if (!resp.ok) {
      throw new Error(`Unexpected status ${resp.status}`);
    }

    const data = await resp.json();
    if (data.status !== 'ignored') {
      throw new Error(`Expected { status: "ignored" }, got: ${JSON.stringify(data)}`);
    }

    console.log('✓ Non-recording event correctly returned { status: "ignored" }');
  } finally {
    server.close();
  }
}

async function testWebhookRecordingReadyAccepted() {
  console.log('\nTest 5: POST /webhook — valid recording.ready returns processing...');

  const app = createApp();
  const server = await startServer(app);
  const port = server.address().port;

  try {
    const body = JSON.stringify({
      resource: 'meetingRecordings',
      event: 'ready',
      data: { id: 'rec-test-123' },
    });

    const hmac = crypto
      .createHmac('sha1', process.env.WEBEX_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    const resp = await fetch(`http://localhost:${port}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-spark-signature': hmac,
      },
      body,
    });

    if (!resp.ok) {
      throw new Error(`Unexpected status ${resp.status}`);
    }

    const data = await resp.json();
    if (data.status !== 'processing') {
      throw new Error(`Expected { status: "processing" }, got: ${JSON.stringify(data)}`);
    }

    console.log('✓ Valid recording.ready event accepted with { status: "processing" }');
  } finally {
    server.close();
  }
}

async function run() {
  await testServerStarts();
  await testHealthEndpoint();
  await testWebhookSignatureRejection();
  await testWebhookIgnoredEvent();
  await testWebhookRecordingReadyAccepted();
}

run()
  .then(() => {
    console.log('\n✓ All tests passed');
    process.exit(0);
  })
  .catch(err => {
    console.error(`\n✗ Test failed: ${err.message}`);
    process.exit(1);
  });
