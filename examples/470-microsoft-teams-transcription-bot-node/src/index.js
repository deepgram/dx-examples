'use strict';

require('dotenv').config();

const express = require('express');
const {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TurnContext,
} = require('botbuilder');

const { TeamsBot } = require('./bot');
const { CallingHandler } = require('./calling');

const PORT = process.env.PORT || 3978;

function createApp() {
  const app = express();
  app.use(express.json());

  const requiredVars = [
    'DEEPGRAM_API_KEY',
    'MICROSOFT_APP_ID',
    'MICROSOFT_APP_PASSWORD',
    'MICROSOFT_APP_TENANT_ID',
  ];
  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`Error: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in your values.');
    process.exit(1);
  }

  const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: process.env.MICROSOFT_APP_ID,
    MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD,
    MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID,
    MicrosoftAppType: 'SingleTenant',
  });

  const adapter = new CloudAdapter(botFrameworkAuth);

  adapter.onTurnError = async (context, error) => {
    console.error('[adapter] Unhandled error:', error.message);
    await context.sendActivity('Sorry, something went wrong.');
  };

  const bot = new TeamsBot();
  const calling = new CallingHandler();

  app.post('/api/messages', async (req, res) => {
    await adapter.process(req, res, (context) => bot.run(context));
  });

  app.post('/api/calling/callback', async (req, res) => {
    try {
      await calling.handleCallback(req.body);
      res.sendStatus(200);
    } catch (err) {
      console.error('[calling] Callback error:', err.message);
      res.sendStatus(500);
    }
  });

  app.post('/api/calling/notification', async (req, res) => {
    try {
      await calling.handleNotification(req.body);
      res.sendStatus(200);
    } catch (err) {
      console.error('[calling] Notification error:', err.message);
      res.sendStatus(500);
    }
  });

  app.get('/', (_req, res) => {
    res.json({ status: 'ok', service: 'deepgram-teams-transcription-bot' });
  });

  app._bot = bot;
  app._calling = calling;
  app._adapter = adapter;

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  POST /api/messages             — Bot Framework messaging endpoint`);
    console.log(`  POST /api/calling/callback      — Graph Calling callback`);
    console.log(`  POST /api/calling/notification   — Graph Calling notification`);
    console.log(`  GET  /                          — Health check`);
  });
}

module.exports = { createApp };
