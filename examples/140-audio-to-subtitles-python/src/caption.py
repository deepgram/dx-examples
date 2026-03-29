#!/usr/bin/env python3
"""Generate SRT or VTT subtitle files from audio using Deepgram STT.

Usage:
    python src/caption.py recording.mp3
    python src/caption.py recording.mp3 --format srt
    python src/caption.py recording.mp3 --format vtt --output captions.vtt
    python src/caption.py --url https://example.com/audio.wav
    python src/caption.py recording.mp3 --diarize --format srt
"""

import argparse
import os
import sys
from pathlib import Path

from deepgram import DeepgramClient
from deepgram_captions import DeepgramConverter, srt, webvtt


def transcribe_file(client: DeepgramClient, file_path: str, **kwargs) -> dict:
    """Transcribe a local audio file and return the raw response dict.

    Uses transcribe_file() which uploads the bytes to Deepgram. The SDK
    auto-detects the audio format from the file header, so no encoding
    parameter is needed for common formats (mp3, wav, flac, ogg, m4a, etc.).
    """
    audio_bytes = Path(file_path).read_bytes()
    # SDK v6: keyword-only arguments in a flat call — not an options object.
    # 'request' takes raw bytes, an Iterator[bytes], or AsyncIterator[bytes].
    response = client.listen.v1.media.transcribe_file(
        request=audio_bytes,
        model=kwargs.get("model", "nova-3"),
        smart_format=True,
        # utterances=True splits the transcript at natural pauses — required
        # for subtitle timing. Without it, channels[0].alternatives[0] gives
        # one giant block with word-level timestamps but no utterance breaks,
        # which produces poor subtitle segmentation.
        utterances=True,
        diarize=kwargs.get("diarize", False),
    )
    # DeepgramConverter accepts either a dict or an object with .to_json().
    # SDK v6 returns a Pydantic model — use model_dump() to get a plain dict.
    return response.model_dump()


def transcribe_url(client: DeepgramClient, url: str, **kwargs) -> dict:
    """Transcribe audio from a public URL.

    Uses transcribe_url() which tells Deepgram to fetch the audio server-side.
    The file never passes through your machine — faster for large files and
    avoids upload bandwidth.
    """
    response = client.listen.v1.media.transcribe_url(
        url=url,
        model=kwargs.get("model", "nova-3"),
        smart_format=True,
        utterances=True,
        diarize=kwargs.get("diarize", False),
    )
    return response.model_dump()


def generate_captions(dg_response: dict, fmt: str = "srt", line_length: int | None = None) -> str:
    """Convert a Deepgram response dict into SRT or VTT subtitle text.

    The deepgram-captions library handles all the timestamp formatting and
    line breaking. It uses utterance boundaries when available (which is why
    we request utterances=True above), falling back to word-level timestamps.
    """
    converter = DeepgramConverter(dg_response)
    if fmt == "vtt":
        return webvtt(converter, line_length=line_length)
    return srt(converter, line_length=line_length)


def main():
    parser = argparse.ArgumentParser(
        description="Generate SRT/VTT subtitles from audio using Deepgram",
        epilog="Examples:\n"
               "  python src/caption.py recording.mp3\n"
               "  python src/caption.py --url https://example.com/audio.wav --format vtt\n"
               "  python src/caption.py interview.wav --diarize --output interview.srt",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("file", nargs="?", help="Local audio/video file to transcribe")
    source.add_argument("--url", help="Public URL of audio to transcribe (Deepgram fetches it server-side)")

    parser.add_argument(
        "--format", choices=["srt", "vtt"], default="srt",
        help="Output format: srt (SubRip, default) or vtt (WebVTT)",
    )
    parser.add_argument("--output", "-o", help="Output file path (default: stdout or <input>.srt/.vtt)")
    parser.add_argument(
        "--model", default="nova-3",
        help="Deepgram model (default: nova-3). Use nova-3-medical for medical audio",
    )
    parser.add_argument(
        "--diarize", action="store_true",
        # Speaker diarization adds ~200ms latency on top of transcription time.
        # Worth it for multi-speaker audio (interviews, meetings) but unnecessary
        # for single-speaker content (podcasts, narration).
        help="Enable speaker diarization (adds speaker labels to subtitles)",
    )
    parser.add_argument(
        "--line-length", type=int, default=None,
        help="Max characters per subtitle line (default: library decides)",
    )

    args = parser.parse_args()

    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        print(
            "Error: DEEPGRAM_API_KEY environment variable is not set.\n"
            "Get a free API key at https://console.deepgram.com/",
            file=sys.stderr,
        )
        sys.exit(1)

    client = DeepgramClient(api_key=api_key)

    if args.url:
        print(f"Transcribing URL: {args.url}", file=sys.stderr)
        dg_response = transcribe_url(client, args.url, model=args.model, diarize=args.diarize)
    else:
        if not Path(args.file).exists():
            print(f"Error: file not found: {args.file}", file=sys.stderr)
            sys.exit(1)
        print(f"Transcribing file: {args.file}", file=sys.stderr)
        dg_response = transcribe_file(client, args.file, model=args.model, diarize=args.diarize)

    captions = generate_captions(dg_response, fmt=args.format, line_length=args.line_length)

    if args.output:
        output_path = args.output
    elif args.file:
        # Default: same name as input file with .srt or .vtt extension
        output_path = str(Path(args.file).with_suffix(f".{args.format}"))
    else:
        # URL mode with no --output: write to stdout
        print(captions)
        return

    Path(output_path).write_text(captions, encoding="utf-8")
    print(f"Subtitles written to: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
