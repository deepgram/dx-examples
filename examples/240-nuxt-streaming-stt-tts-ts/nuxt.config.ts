export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',

  nitro: {
    experimental: {
      websocket: true,
    },
  },

  runtimeConfig: {
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
  },
});
