import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import TranscriptionScreen from './TranscriptionScreen';

// In a real app you'd load this from a secure backend token endpoint,
// NOT bundle it in the client. Shipping an API key in a mobile binary
// means anyone can extract it with a decompiler.
// For this demo, it's read from the Expo config's `extra` field
// (set via app.config.js or .env at build time).
const API_KEY = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY || '';

export default function App() {
  return (
    <SafeAreaView style={styles.safe}>
      <TranscriptionScreen apiKey={API_KEY} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
