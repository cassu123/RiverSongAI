# =============================================================================
# providers/google/youtube_music.py
#
# YouTube Music provider for River Song AI.
#
# Responsibilities:
#   - Search YouTube Music for tracks, albums, and playlists by query string.
#   - Extract the best audio stream URL for a search result using yt-dlp.
#   - Play audio via sounddevice + soundfile (same approach as PiperTTS).
#   - Stop currently playing audio on request.
#
# Architecture note:
#   ytmusicapi handles YouTube Music catalog search (no OAuth required for
#   search). yt-dlp handles stream extraction. Playback is done via sounddevice
#   to stay consistent with the rest of the audio pipeline.
#
# yt-dlp extracts streams without downloading full files by using the best
#   available audio-only format and streaming it through ffmpeg to soundfile
#   for in-memory decoding.
#
# Required packages: ytmusicapi, yt-dlp, sounddevice, soundfile, numpy
# No OAuth required for basic search and playback.
# =============================================================================

from __future__ import annotations

import asyncio
import logging
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

import sounddevice as sd
import soundfile as sf


logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ytmusic")

# yt-dlp format selector: best audio-only, prefer opus/webm, fallback to any audio.
_YTDLP_FORMAT = "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio"


class YouTubeMusicProvider:
    """
    YouTube Music search and playback provider.

    Uses ytmusicapi for catalog search and yt-dlp for audio stream extraction.
    Playback runs in a thread pool to avoid blocking the async event loop.

    Args:
        audio_output_device: sounddevice output device index. None uses the
            system default.
    """

    def __init__(self, audio_output_device: Optional[int] = None) -> None:
        self._output_device = audio_output_device
        self._stop_event: Optional[asyncio.Event] = None
        self._ytm = None

    def _get_stop_event(self) -> asyncio.Event:
        """Return the stop event, creating it lazily inside the running loop."""
        if self._stop_event is None:
            self._stop_event = asyncio.Event()
        return self._stop_event

    def _get_ytm(self):
        """Return a YTMusic instance, initializing it on first use."""
        if self._ytm is None:
            from ytmusicapi import YTMusic
            self._ytm = YTMusic()
        return self._ytm

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    async def search(
        self,
        query: str,
        filter_type: str = "songs",
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Search YouTube Music for tracks, albums, or playlists.

        Args:
            query: Search string (e.g., "Bohemian Rhapsody Queen").
            filter_type: Result type to filter for. Valid values:
                'songs', 'videos', 'albums', 'artists', 'playlists'
            limit: Maximum number of results to return.

        Returns:
            List of result dicts from ytmusicapi. Song results contain at
            minimum: 'videoId', 'title', 'artists', 'duration'.
            Returns empty list if the search yields no results.
        """
        def _do_search() -> List[Dict[str, Any]]:
            ytm = self._get_ytm()
            results = ytm.search(query, filter=filter_type, limit=limit)
            return results or []

        loop = asyncio.get_running_loop()
        results = await loop.run_in_executor(_executor, _do_search)
        logger.info(
            "YouTube Music search '%s' (%s) returned %d result(s).",
            query,
            filter_type,
            len(results),
        )
        return results

    async def play_video_id(self, video_id: str) -> None:
        """
        Extract audio for a YouTube video ID and play it through the speakers.

        Audio is extracted via yt-dlp to a temporary file and played with
        sounddevice. Blocks (in the thread pool) until playback completes or
        stop() is called.

        Args:
            video_id: YouTube video ID (e.g., "dQw4w9WgXcQ").

        Raises:
            RuntimeError: If yt-dlp fails to extract a stream.
            soundfile.SoundFileError: If the downloaded audio cannot be decoded.
        """
        self._get_stop_event().clear()
        url = f"https://www.youtube.com/watch?v={video_id}"

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(_executor, self._download_and_play, url)

    async def play_first_result(self, query: str) -> str:
        """
        Search for a query and immediately play the first song result.

        Args:
            query: Natural-language music request, e.g. "play Bohemian Rhapsody".

        Returns:
            A spoken confirmation string describing what is being played, e.g.
            "Playing Bohemian Rhapsody by Queen."

        Raises:
            RuntimeError: If no results are found or playback fails.
        """
        results = await self.search(query, filter_type="songs", limit=1)
        if not results:
            return f"Sorry, I could not find any music matching '{query}'."

        first = results[0]
        video_id = first.get("videoId")
        title = first.get("title", "Unknown title")
        artists_raw = first.get("artists", [])
        artist_names = ", ".join(a.get("name", "") for a in artists_raw if a.get("name"))

        if not video_id:
            return "Sorry, that result did not have a playable stream."

        # Start playback in the background -- do not await so TTS can speak first.
        asyncio.create_task(self.play_video_id(video_id))

        if artist_names:
            return f"Playing {title} by {artist_names}."
        return f"Playing {title}."

    def stop(self) -> None:
        """Signal the currently playing audio to stop at the next buffer boundary."""
        if self._stop_event is not None:
            self._stop_event.set()
        logger.info("Stop signal sent to YouTube Music playback.")

    # -------------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------------

    def _download_and_play(self, url: str) -> None:
        """
        Download audio to a temp file via yt-dlp and play with sounddevice.

        Runs synchronously -- call from a thread pool executor only.

        Args:
            url: Full YouTube URL to download.

        Raises:
            RuntimeError: If yt-dlp exits with a non-zero return code.
        """
        with tempfile.NamedTemporaryFile(suffix=".opus", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            cmd = [
                "yt-dlp",
                "--format", _YTDLP_FORMAT,
                "--output", tmp_path,
                "--no-playlist",
                "--quiet",
                url,
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=60, shell=False)
            if result.returncode != 0:
                stderr = result.stderr.decode("utf-8", errors="replace").strip()
                raise RuntimeError(
                    f"yt-dlp failed (exit {result.returncode}): {stderr}"
                )

            with sf.SoundFile(tmp_path) as audio_file:
                blocksize = 1024
                device = self._output_device
                with sd.OutputStream(
                    samplerate=audio_file.samplerate,
                    channels=audio_file.channels,
                    device=device,
                ) as stream:
                    while not (self._stop_event and self._stop_event.is_set()):
                        data = audio_file.read(blocksize, dtype="float32")
                        if len(data) == 0:
                            break
                        stream.write(data)

        finally:
            import os
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    # -------------------------------------------------------------------------
    # Natural-language formatting helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def format_results_for_speech(results: List[Dict[str, Any]]) -> str:
        """
        Convert search results into a TTS-friendly string.

        Args:
            results: Song result dicts from ytmusicapi.

        Returns:
            Plain-text summary suitable for reading aloud.
        """
        if not results:
            return "No music results found."

        lines = [f"Found {len(results)} result(s)."]
        for i, r in enumerate(results, 1):
            title = r.get("title", "Unknown")
            artists = ", ".join(
                a.get("name", "") for a in r.get("artists", []) if a.get("name")
            )
            duration = r.get("duration", "")
            if artists:
                lines.append(f"{i}. {title} by {artists}{', ' + duration if duration else ''}.")
            else:
                lines.append(f"{i}. {title}{', ' + duration if duration else ''}.")

        return " ".join(lines)


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------

def build_youtube_music_provider() -> YouTubeMusicProvider:
    """
    Convenience factory that builds a YouTubeMusicProvider using app settings.

    Returns:
        Configured YouTubeMusicProvider instance.
    """
    from config.settings import get_settings
    s = get_settings()
    return YouTubeMusicProvider(audio_output_device=s.audio_output_device)
