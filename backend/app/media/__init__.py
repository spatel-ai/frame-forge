"""Joining banner clips around the AI video with ffmpeg (HLD 5.4, D-019, D-066), and storing
finished videos (S3, owner 2026-11-17).

Joining works on files alone: it knows nothing of jobs, the wallet or the database, and calls no
paid service, so a failed join may simply be run again.
"""

from app.media.joining import MediaError, MediaInfo, compose, join, measure

__all__ = ["MediaError", "MediaInfo", "compose", "join", "measure"]
