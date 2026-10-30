"""Speech service (FR-E8).

Renders an approved script into playable audio (TTS), joins segments with
FFmpeg, and transcribes spoken questions with Whisper.

TODO(owner): wire a TTS engine + FFmpeg. Keep the signature:
    render_audio(script) -> list[AudioSegment]
"""
from __future__ import annotations

from app.core.schemas import AudioSegment, Script


def render_audio(script: Script) -> list[AudioSegment]:
    """Synthesize audio for each segment of an approved script.

    Stub: returns placeholder audio urls. Rendering an UNAPPROVED script is a
    hard error (NFR-3).
    """
    if not script.approved:
        raise ValueError("Refusing to render audio for an unapproved script.")

    # TODO(owner): call the TTS engine per segment, write files to storage, and
    # concatenate with FFmpeg. Associate audio with the approved script version.
    segments: list[AudioSegment] = []
    for seg in script.segments:
        segments.append(
            AudioSegment(
                segment_id=seg.segment_id,
                audio_url=f"/static/audio/{script.document_id}/{seg.segment_id}.wav",
                duration_seconds=0.0,
            )
        )
    return segments


def transcribe(audio_path: str) -> str:
    """Transcribe a spoken listener question.

    TODO(owner): run Whisper on `audio_path`.
    """
    return "[placeholder] transcription not yet implemented."
