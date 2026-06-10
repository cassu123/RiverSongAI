"""
daemons/sifter/sifter.py

Sifter — background document indexer for RAG.

Walks WAPS_DOCUMENTS_PATH on an interval, ingests new or modified
documents into the RAG vector store, and remembers what it has indexed
in a small JSON state file so unchanged files are never re-ingested.
"""

import asyncio
import json
import logging
from pathlib import Path

from daemons.base_daemon import BaseDaemon

logger = logging.getLogger(__name__)

# Document types the RAG extractors understand.
_INDEXABLE_SUFFIXES = {
    ".pdf", ".txt", ".md", ".docx", ".doc", ".html", ".htm",
    ".csv", ".rtf", ".epub",
}

_SCAN_INTERVAL_S = 300       # full directory sweep every 5 minutes
_MAX_FILE_BYTES = 50 * 1024 * 1024  # skip anything over 50 MB

_STATE_FILE = Path("data") / "sifter_state.json"


class SifterDaemon(BaseDaemon):
    name = "sifter"

    async def _main_loop(self) -> None:
        if not self.settings.sifter_enabled:
            while self._running:
                await asyncio.sleep(60)
            return

        state = self._load_state()
        logger.info(
            "Sifter starting — indexing %s (%d files known)",
            self.settings.waps_documents_path, len(state),
        )

        while self._running:
            try:
                changed = await self._scan_once(state)
                if changed:
                    self._save_state(state)
            except Exception:
                logger.exception("Sifter scan failed; retrying next cycle")
            await self._sleep_interruptible(_SCAN_INTERVAL_S)

    async def _scan_once(self, state: dict) -> bool:
        """One sweep of the documents directory. Returns True if state changed."""
        root = Path(self.settings.waps_documents_path)
        if not root.is_dir():
            logger.debug("Sifter: documents path %s does not exist yet", root)
            return False

        changed = False
        for path in sorted(root.rglob("*")):
            if not self._running:
                break
            if not path.is_file() or path.suffix.lower() not in _INDEXABLE_SUFFIXES:
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            if stat.st_size > _MAX_FILE_BYTES or stat.st_size == 0:
                continue

            key = str(path)
            fingerprint = f"{stat.st_mtime_ns}:{stat.st_size}"
            if state.get(key) == fingerprint:
                continue  # unchanged since last ingest

            if await self._ingest(path):
                state[key] = fingerprint
                changed = True

        # Forget files that no longer exist so they can re-index if restored.
        missing = [k for k in state if not Path(k).exists()]
        for k in missing:
            del state[k]
            changed = True
        return changed

    async def _ingest(self, path: Path) -> bool:
        """Ingest one file into the RAG store. Returns True on success."""
        from providers.rag.rag_provider import RAGProvider
        try:
            file_bytes = path.read_bytes()
            rag = RAGProvider()
            chunks = await rag.ingest_document(file_bytes, {
                "filename": path.name,
                "source_type": "document",
                "source": "sifter",
                "path": str(path),
            })
            logger.info("Sifter indexed %s (%d chunks)", path.name, chunks)
            return True
        except Exception:
            logger.exception("Sifter failed to ingest %s", path)
            return False

    async def _sleep_interruptible(self, seconds: int) -> None:
        """Sleep in 1s slices so daemon shutdown isn't delayed a full cycle."""
        for _ in range(seconds):
            if not self._running:
                return
            await asyncio.sleep(1)

    def _load_state(self) -> dict:
        try:
            return json.loads(_STATE_FILE.read_text())
        except (OSError, ValueError):
            return {}

    def _save_state(self, state: dict) -> None:
        try:
            _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
            _STATE_FILE.write_text(json.dumps(state))
        except OSError:
            logger.exception("Sifter could not persist its state file")
