'use strict';

const fs = require('fs');
const path = require('path');
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

const { createApp, extractVideoId } = require('../src/server.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testExtractVideoId() {
  console.log('Test 1: extractVideoId() parses various Loom URL formats...');

  assert(
    extractVideoId('https://www.loom.com/share/abc123def456') === 'abc123def456',
    'Failed to parse standard share URL'
  );

  assert(
    extractVideoId('https://loom.com/share/abc123def456') === 'abc123def456',
    'Failed to parse share URL without www'
  );

  assert(
    extractVideoId('https://www.loom.com/share/abc123def456?sid=xyz') === 'abc123def456',
    'Failed to parse share URL with query params'
  );

  assert(
    extractVideoId('abc123def456abcd') === 'abc123def456abcd',
    'Failed to parse bare video ID'
  );

  assert(
    extractVideoId('not-a-valid-url') === null,
    'Should return null for invalid input'
  );

  assert(
    extractVideoId('') === null,
    'Should return null for empty string'
  );

  assert(
    extractVideoId(null) === null,
    'Should return null for null input'
  );

  console.log('  extractVideoId() correctly parses all URL formats');
}

async function testServerStarts() {
  console.log('\nTest 2: createApp() returns a configured Express app...');

  const app = createApp();
  assert(
    typeof app === 'function' || typeof app.listen === 'function',
    'createApp() did not return an Express application'
  );

  console.log('  createApp() returned an Express app');
}

async function testHealthEndpoint() {
  console.log('\nTest 3: GET /health returns { status: "ok" }...');

  const app = createApp();

  await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, async () => {
      const port = server.address().port;
      try {
        const resp = await fetch(`http://localhost:${port}/health`);
        const data = await resp.json();
        assert(data.status === 'ok', `Expected { status: "ok" }, got: ${JSON.stringify(data)}`);
        console.log('  GET /health returned { status: "ok" }');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
    server.on('error', reject);
  });
}

async function testTranscribeMissingUrl() {
  console.log('\nTest 4: POST /transcribe without URL returns 400...');

  const app = createApp();

  await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, async () => {
      const port = server.address().port;
      try {
        const resp = await fetch(`http://localhost:${port}/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        assert(resp.status === 400, `Expected 400, got ${resp.status}`);

        const data = await resp.json();
        assert(data.error, 'Expected error field in 400 response');
        console.log('  Missing URL correctly returned 400');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
    server.on('error', reject);
  });
}

async function testTranscribeInvalidUrl() {
  console.log('\nTest 5: POST /transcribe with invalid URL returns 400...');

  const app = createApp();

  await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, async () => {
      const port = server.address().port;
      try {
        const resp = await fetch(`http://localhost:${port}/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/not-loom' }),
        });

        assert(resp.status === 400, `Expected 400, got ${resp.status}`);

        const data = await resp.json();
        assert(data.error, 'Expected error field in 400 response');
        console.log('  Invalid URL correctly returned 400');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
    server.on('error', reject);
  });
}

async function run() {
  await testExtractVideoId();
  await testServerStarts();
  await testHealthEndpoint();
  await testTranscribeMissingUrl();
  await testTranscribeInvalidUrl();
}

run()
  .then(() => {
    console.log('\nAll tests passed');
    process.exit(0);
  })
  .catch(err => {
    console.error(`\nTest failed: ${err.message}`);
    process.exit(1);
  });
