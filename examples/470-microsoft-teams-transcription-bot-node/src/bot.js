'use strict';

const {
  TeamsActivityHandler,
  TurnContext,
  MessageFactory,
} = require('botbuilder');

const { GraphClient } = require('./graph');

class TeamsBot extends TeamsActivityHandler {
  constructor() {
    super();
    this._conversationReferences = new Map();
    this._graphClient = new GraphClient();

    this.onMessage(async (context, next) => {
      const text = (context.activity.text || '').trim().toLowerCase();
      TurnContext.removeRecipientMention(context.activity);

      if (text.includes('join') || text.includes('transcribe')) {
        await this._handleJoinCommand(context);
      } else if (text.includes('leave') || text.includes('stop')) {
        await this._handleLeaveCommand(context);
      } else {
        await context.sendActivity(
          'Send **join** to start transcribing the current meeting, or **leave** to stop.'
        );
      }

      await next();
    });

    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(
            'Hello! I can transcribe your Teams meetings in real-time using Deepgram. ' +
            'Send **join** to start transcribing the current meeting.'
          );
        }
      }
      await next();
    });
  }

  async _handleJoinCommand(context) {
    const meetingInfo = await this._getMeetingInfo(context);
    if (!meetingInfo) {
      await context.sendActivity(
        'I could not detect a meeting. Please use this command from within a Teams meeting chat.'
      );
      return;
    }

    this._storeConversationReference(context);

    await context.sendActivity('Joining the meeting to start transcription...');

    try {
      const callId = await this._graphClient.joinMeeting(meetingInfo);
      this._conversationReferences.set(callId, {
        ref: TurnContext.getConversationReference(context.activity),
        meetingInfo,
      });
      await context.sendActivity(
        `Joined the meeting. Live transcriptions will appear here. Call ID: \`${callId}\``
      );
    } catch (err) {
      console.error('[bot] Failed to join meeting:', err.message);
      await context.sendActivity(
        `Failed to join the meeting: ${err.message}. ` +
        'Ensure the bot has the required Azure AD permissions.'
      );
    }
  }

  async _handleLeaveCommand(context) {
    const activeCalls = Array.from(this._conversationReferences.entries());
    if (activeCalls.length === 0) {
      await context.sendActivity('No active transcription sessions.');
      return;
    }

    for (const [callId] of activeCalls) {
      try {
        await this._graphClient.leaveCall(callId);
        this._conversationReferences.delete(callId);
      } catch (err) {
        console.error(`[bot] Failed to leave call ${callId}:`, err.message);
      }
    }

    await context.sendActivity('Stopped transcription and left the meeting.');
  }

  async _getMeetingInfo(context) {
    const meeting = context.activity.channelData?.meeting;
    if (meeting?.id) {
      return {
        meetingId: meeting.id,
        tenantId: context.activity.channelData?.tenant?.id || process.env.MICROSOFT_APP_TENANT_ID,
      };
    }

    const conversationType = context.activity.conversation?.conversationType;
    if (conversationType === 'groupChat' || conversationType === 'channel') {
      return {
        threadId: context.activity.conversation.id,
        tenantId: context.activity.channelData?.tenant?.id || process.env.MICROSOFT_APP_TENANT_ID,
        messageId: context.activity.id,
      };
    }

    return null;
  }

  _storeConversationReference(context) {
    const ref = TurnContext.getConversationReference(context.activity);
    this._conversationReferences.set(context.activity.conversation.id, { ref });
  }

  async postTranscript(callId, transcript, speaker) {
    const entry = this._conversationReferences.get(callId);
    if (!entry?.ref) return;

    const text = speaker
      ? `**${speaker}:** ${transcript}`
      : transcript;

    try {
      const adapter = this._adapter;
      if (adapter) {
        await adapter.continueConversationAsync(
          process.env.MICROSOFT_APP_ID,
          entry.ref,
          async (context) => {
            await context.sendActivity(MessageFactory.text(text));
          }
        );
      }
    } catch (err) {
      console.error('[bot] Failed to post transcript:', err.message);
    }
  }

  setAdapter(adapter) {
    this._adapter = adapter;
  }

  getConversationReferences() {
    return this._conversationReferences;
  }
}

module.exports = { TeamsBot };
