'use strict';

// This file exports the core hook and component for use in a React Native app.
// See useDeepgramTranscription.js for the live STT hook implementation.
// See TranscriptionScreen.js for the UI component.

module.exports = {
  useDeepgramTranscription: require('./useDeepgramTranscription'),
  TranscriptionScreen: require('./TranscriptionScreen'),
};
