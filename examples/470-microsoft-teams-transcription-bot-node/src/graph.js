'use strict';

const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const {
  TokenCredentialAuthenticationProvider,
} = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');

class GraphClient {
  constructor() {
    this._credential = new ClientSecretCredential(
      process.env.MICROSOFT_APP_TENANT_ID,
      process.env.MICROSOFT_APP_ID,
      process.env.MICROSOFT_APP_PASSWORD
    );

    const authProvider = new TokenCredentialAuthenticationProvider(this._credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    });

    this._client = Client.initWithMiddleware({ authProvider });

    this._activeCalls = new Map();
  }

  async joinMeeting(meetingInfo) {
    const baseUrl = process.env.BOT_BASE_URL || `https://localhost:${process.env.PORT || 3978}`;
    const callbackUrl = `${baseUrl}/api/calling/callback`;

    const requestBody = {
      '@odata.type': '#microsoft.graph.call',
      callbackUri: callbackUrl,
      tenantId: meetingInfo.tenantId,
      mediaConfig: {
        '@odata.type': '#microsoft.graph.appHostedMediaConfig',
        blob: JSON.stringify({
          audioSocketUri: `${baseUrl}/api/calling/notification`,
        }),
      },
      requestedModalities: ['audio'],
      source: {
        '@odata.type': '#microsoft.graph.participantInfo',
        identity: {
          '@odata.type': '#microsoft.graph.identitySet',
          application: {
            '@odata.type': '#microsoft.graph.identity',
            id: process.env.MICROSOFT_APP_ID,
            displayName: 'Deepgram Transcription Bot',
          },
        },
      },
    };

    if (meetingInfo.meetingId) {
      requestBody.chatInfo = {
        '@odata.type': '#microsoft.graph.chatInfo',
        threadId: meetingInfo.meetingId,
        messageId: '0',
      };
      requestBody.meetingInfo = {
        '@odata.type': '#microsoft.graph.organizerMeetingInfo',
        organizer: {
          '@odata.type': '#microsoft.graph.identitySet',
          user: {
            '@odata.type': '#microsoft.graph.identity',
            tenantId: meetingInfo.tenantId,
          },
        },
      };
    } else if (meetingInfo.threadId) {
      requestBody.chatInfo = {
        '@odata.type': '#microsoft.graph.chatInfo',
        threadId: meetingInfo.threadId,
        messageId: meetingInfo.messageId || '0',
      };
    }

    const call = await this._client.api('/communications/calls').post(requestBody);
    const callId = call.id;
    this._activeCalls.set(callId, { state: 'establishing', meetingInfo });
    console.log(`[graph] Call created — ID: ${callId}`);
    return callId;
  }

  async leaveCall(callId) {
    try {
      await this._client.api(`/communications/calls/${callId}`).delete();
      this._activeCalls.delete(callId);
      console.log(`[graph] Left call ${callId}`);
    } catch (err) {
      console.error(`[graph] Error leaving call ${callId}:`, err.message);
      this._activeCalls.delete(callId);
    }
  }

  async subscribeToAudio(callId) {
    try {
      await this._client
        .api(`/communications/calls/${callId}/subscribeToTone`)
        .post({ clientContext: 'deepgram-transcription' });
      console.log(`[graph] Subscribed to audio for call ${callId}`);
    } catch (err) {
      console.error(`[graph] Audio subscription error for ${callId}:`, err.message);
    }
  }

  getActiveCalls() {
    return this._activeCalls;
  }

  getClient() {
    return this._client;
  }
}

module.exports = { GraphClient };
