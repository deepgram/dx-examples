"""
Silero VAD Speech Segmentation with Deepgram STT

Detects speech regions in an audio file using Silero VAD, extracts each segment,
and transcribes them individually with Deepgram. Produces a timestamped transcript
where each entry corresponds to a detected speech region.

Usage:
    python src/segmenter.py path/to/audio.wav
    python src/segmenter.py path/to/audio.wav --threshold 0.4 --min-speech 500
"""

from __future__ import annotations

import io
import os
import sys
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import torch
import torchaudio
from dotenv import load_dotenv
from silero_vad import get_speech_timestamps, load_silero_vad, read_audio

from deepgram import DeepgramClient

load_dotenv()

SAMPLE_RATE = 16000


@dataclass
class SpeechSegment:
    start_sec: float
    end_sec: float
    transcript: str
    confidence: float


def detect_speech_regions(
    audio_path: str,
    threshold: float = 0.5,
    min_speech_duration_ms: int = 250,
    min_silence_duration_ms: int = 100,
    speech_pad_ms: int = 30,
) -> tuple[torch.Tensor, list[dict]]:
    # Silero VAD expects 16 kHz mono audio — read_audio handles resampling
    wav = read_audio(audio_path, sampling_rate=SAMPLE_RATE)
    model = load_silero_vad()

    timestamps = get_speech_timestamps(
        wav,
        model,
        threshold=threshold,
        sampling_rate=SAMPLE_RATE,
        min_speech_duration_ms=min_speech_duration_ms,
        min_silence_duration_ms=min_silence_duration_ms,
        speech_pad_ms=speech_pad_ms,
        return_seconds=False,  # ← sample indices, not seconds — needed for slicing
    )

    return wav, timestamps


def extract_segment_bytes(wav: torch.Tensor, start_sample: int, end_sample: int) -> bytes:
    segment = wav[start_sample:end_sample]

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(SAMPLE_RATE)
        # Convert float tensor [-1, 1] to 16-bit PCM
        pcm = (segment * 32767).clamp(-32768, 32767).to(torch.int16)
        wf.writeframes(pcm.numpy().tobytes())

    return buf.getvalue()


def transcribe_segments(
    wav: torch.Tensor,
    timestamps: list[dict],
    client: Optional[DeepgramClient] = None,
) -> list[SpeechSegment]:
    if client is None:
        client = DeepgramClient()

    results: list[SpeechSegment] = []

    for ts in timestamps:
        start_sample = ts["start"]
        end_sample = ts["end"]
        start_sec = start_sample / SAMPLE_RATE
        end_sec = end_sample / SAMPLE_RATE

        audio_bytes = extract_segment_bytes(wav, start_sample, end_sample)

        # Transcribe each speech segment individually via Deepgram
        response = client.listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-3",
            smart_format=True,
            tag="deepgram-examples",  # ← REQUIRED: tags traffic in the Deepgram console
        )

        transcript = response.results.channels[0].alternatives[0].transcript
        confidence = response.results.channels[0].alternatives[0].confidence

        results.append(
            SpeechSegment(
                start_sec=round(start_sec, 3),
                end_sec=round(end_sec, 3),
                transcript=transcript,
                confidence=confidence,
            )
        )

    return results


def process_audio(
    audio_path: str,
    threshold: float = 0.5,
    min_speech_duration_ms: int = 250,
    min_silence_duration_ms: int = 100,
    speech_pad_ms: int = 30,
    client: Optional[DeepgramClient] = None,
) -> list[SpeechSegment]:
    wav, timestamps = detect_speech_regions(
        audio_path,
        threshold=threshold,
        min_speech_duration_ms=min_speech_duration_ms,
        min_silence_duration_ms=min_silence_duration_ms,
        speech_pad_ms=speech_pad_ms,
    )

    if not timestamps:
        print("No speech detected in audio.")
        return []

    print(f"Detected {len(timestamps)} speech region(s). Transcribing...")

    return transcribe_segments(wav, timestamps, client=client)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Segment audio with Silero VAD and transcribe with Deepgram"
    )
    parser.add_argument("audio_path", help="Path to audio file (WAV, MP3, etc.)")
    parser.add_argument("--threshold", type=float, default=0.5, help="VAD speech probability threshold (0-1)")
    parser.add_argument("--min-speech", type=int, default=250, help="Minimum speech duration in ms")
    parser.add_argument("--min-silence", type=int, default=100, help="Minimum silence duration in ms to split segments")
    parser.add_argument("--pad", type=int, default=30, help="Padding in ms added around each speech segment")
    args = parser.parse_args()

    if not os.environ.get("DEEPGRAM_API_KEY"):
        print("Error: DEEPGRAM_API_KEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    if not Path(args.audio_path).exists():
        print(f"Error: File not found: {args.audio_path}", file=sys.stderr)
        sys.exit(1)

    segments = process_audio(
        args.audio_path,
        threshold=args.threshold,
        min_speech_duration_ms=args.min_speech,
        min_silence_duration_ms=args.min_silence,
        speech_pad_ms=args.pad,
    )

    if not segments:
        return

    print(f"\n{'='*60}")
    print(f"  Transcribed {len(segments)} segment(s)")
    print(f"{'='*60}\n")

    for i, seg in enumerate(segments, 1):
        print(f"[{seg.start_sec:.1f}s - {seg.end_sec:.1f}s] (confidence: {seg.confidence:.2f})")
        print(f"  {seg.transcript}\n")


if __name__ == "__main__":
    main()
