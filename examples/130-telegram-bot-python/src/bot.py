"""Telegram bot that transcribes voice messages using Deepgram nova-3.

Send a voice message to the bot and it replies with the transcript.

Usage:
    python src/bot.py

Requires DEEPGRAM_API_KEY and TELEGRAM_BOT_TOKEN in the environment
(or in a .env file alongside this project).
"""

import logging
import os
import urllib.request
from io import BytesIO

from dotenv import load_dotenv
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

load_dotenv()

# SDK v5 Python: DeepgramClient reads DEEPGRAM_API_KEY from env automatically.
# Import at module level so missing-key errors surface at startup, not on first message.
from deepgram import DeepgramClient

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
# python-telegram-bot uses httpx internally — silence its noisy debug logs.
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


def transcribe_voice(file_path_or_url: str, api_key: str) -> str | None:
    """Download audio from a file path or public URL and transcribe via Deepgram.

    This is the testable entry point: accepts a plain path/URL and API key so
    tests can call it without a running Telegram bot.

    Args:
        file_path_or_url: Local file path or publicly accessible audio URL.
        api_key: Deepgram API key.

    Returns:
        Transcript text, or None if no speech was detected.
    """
    # Load audio bytes from path or URL.
    if file_path_or_url.startswith("http://") or file_path_or_url.startswith("https://"):
        with urllib.request.urlopen(file_path_or_url) as resp:
            audio_bytes = resp.read()
    else:
        with open(file_path_or_url, "rb") as f:
            audio_bytes = f.read()

    if not audio_bytes:
        return None

    client = DeepgramClient(api_key=api_key)

    # SDK v5 Python: transcribe_file() accepts raw bytes.
    # Deepgram auto-detects the audio format from the file header.
    # nova-3 is the current flagship model (2025). For phone-call
    # audio use nova-3-phonecall; for medical dictation use nova-3-medical.
    response = client.listen.v1.media.transcribe_file(
        request=audio_bytes,
        model="nova-3",
        smart_format=True,
        tag="deepgram-examples",
    )

    transcript = response.results.channels[0].alternatives[0].transcript
    return transcript if transcript else None


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reply to /start with usage instructions."""
    await update.message.reply_text(
        "Send me a voice message and I'll transcribe it using Deepgram!"
    )


async def handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Download a voice message, transcribe it with Deepgram, and reply with the text."""
    voice = update.message.voice

    # Telegram voice messages are Opus-encoded OGG files.
    # Deepgram natively supports OGG/Opus, so no conversion is needed —
    # we send the bytes directly to the SDK.
    file = await voice.get_file()
    audio_buf = BytesIO()
    await file.download_to_memory(audio_buf)
    audio_bytes = audio_buf.getvalue()

    if len(audio_bytes) == 0:
        await update.message.reply_text("Voice message was empty — nothing to transcribe.")
        return

    await update.message.reply_text("Transcribing…")

    try:
        client = DeepgramClient()

        # SDK v5 Python: transcribe_file() accepts raw bytes.
        # Deepgram auto-detects the audio format from the file header.
        # nova-3 is the current flagship model (2025). For phone-call
        # audio use nova-3-phonecall; for medical dictation use nova-3-medical.
        response = client.listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-3",
            smart_format=True,
            tag="deepgram-examples",
        )

        transcript = response.results.channels[0].alternatives[0].transcript

        if not transcript:
            await update.message.reply_text(
                "No speech detected — try speaking more clearly or for longer."
            )
            return

        # confidence is 0–1. Below 0.7 usually means poor audio quality,
        # heavy background noise, or an unsupported language.
        confidence = response.results.channels[0].alternatives[0].confidence
        logger.info("Transcribed %d bytes (confidence=%.2f)", len(audio_bytes), confidence)

        await update.message.reply_text(transcript)

    except Exception as exc:
        # Common errors: 402 (free-tier quota exceeded), 400 (corrupt audio).
        # Surface the SDK error directly — it's usually self-explanatory.
        logger.exception("Transcription failed")
        await update.message.reply_text(f"Transcription failed: {exc}")


def main() -> None:
    """Start the bot with long-polling."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit(
            "TELEGRAM_BOT_TOKEN not set. "
            "Create a bot via @BotFather and set the token: "
            "https://core.telegram.org/bots/tutorial#obtain-your-bot-token"
        )

    if not os.environ.get("DEEPGRAM_API_KEY"):
        raise SystemExit(
            "DEEPGRAM_API_KEY not set. "
            "Get a free key at https://console.deepgram.com/"
        )

    application = Application.builder().token(token).build()

    application.add_handler(CommandHandler("start", start))
    # filters.VOICE matches voice recordings made in the Telegram app.
    # filters.AUDIO matches uploaded audio files (MP3, WAV, etc.) — add it
    # alongside VOICE if you want to support both.
    application.add_handler(MessageHandler(filters.VOICE, handle_voice))

    logger.info("Bot started — listening for voice messages")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
