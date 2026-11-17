"""Joining banner clips around the AI video with ffmpeg (HLD 5.4, D-019).

Works on files alone: it knows nothing of jobs, the wallet or the database, and calls no paid
service, so a failed join may simply be run again.
"""

from app.media.join import MediaError, MediaInfo, join, measure

__all__ = ["MediaError", "MediaInfo", "join", "measure"]
