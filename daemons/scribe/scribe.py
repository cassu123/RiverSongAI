import asyncio
import logging
import os
from pathlib import Path
from datetime import datetime, timezone

from daemons.base_daemon import BaseDaemon
from config.settings import get_settings

logger = logging.getLogger(__name__)

class ScribeDaemon(BaseDaemon):
    """
    Scribe: The Chronological Heuristic Record daemon.
    Responsible for background processing of CHRONOS notes, extracting facts,
    and maintaining the semantic timeline.
    """
    name = "scribe"

    async def _handle_task(self, action: str, payload: dict) -> dict:
        if action == "analyze_note":
            path = payload.get("path")
            return await self._analyze_note(path)
        return {"error": f"unknown action {action}"}

    async def _main_loop(self) -> None:
        if not self.settings.daemon_scribe_enabled:
            logger.info("Scribe: disabled in settings. Idle loop started.")
            while self._running:
                await asyncio.sleep(60)
            return

        logger.info("Scribe: starting. Heuristic engine active.")
        
        while self._running:
            # Scribe runs on a slow tick to scan for new insights.
            try:
                await self._run_heuristic_scan()
            except Exception as e:
                logger.error("Scribe: main loop iteration failed: %s", e)
            await asyncio.sleep(300)

    async def _run_heuristic_scan(self) -> None:
        """Scan the vault for notes that need deeper analysis."""
        logger.info("Scribe: performing vault heuristic scan...")
        
        try:
            from main import get_app
            app = get_app()
            if not app: 
                logger.warning("Scribe: app not available yet.")
                return
            
            memory_manager = getattr(app.state, "memory_manager", None)
            if not memory_manager: 
                logger.warning("Scribe: memory_manager not available.")
                return
            
            store = memory_manager._store
            
            # 1. Find stale notes (mtime > indexed_at)
            # indexed_at is stored in vault_notes table
            # We'll use a raw query since the store doesn't have a high-level helper for this
            loop = asyncio.get_running_loop()
            stale_notes = await loop.run_in_executor(None, self._get_stale_notes, store)
            
            if not stale_notes:
                logger.debug("Scribe: No stale notes found.")
                return

            checked_count = len(stale_notes)
            reindexed_count = 0
            facts_extracted = 0

            # 2. For each stale note, extract facts
            from core.conversation_loop import _build_llm_provider
            llm, _ = _build_llm_provider()
            
            for note in stale_notes:
                vpath = note["virtual_path"]
                try:
                    # Resolve physical path (we need the VaultProvider for this)
                    from providers.vault.vault_provider import VaultProvider
                    v_prov = VaultProvider(store=store)
                    
                    # We need a user_id to resolve virtual path. 
                    # If owner_kind is 'user', owner_id is the user_id.
                    # If 'household', we might need to skip or use a default.
                    # For now, let's focus on user notes.
                    if note["owner_kind"] != "user":
                        continue
                        
                    user_id = note["owner_id"]
                    content = await v_prov.read_note(user_id, vpath)
                    
                    if not content: continue

                    # 3. Trigger LLM extraction
                    facts = await self._extract_facts_from_note(llm, content)
                    if facts:
                        for f in facts:
                            await memory_manager.upsert_fact(
                                user_id=user_id,
                                key=f["key"],
                                value=f["value"],
                                source="scribe"
                            )
                            facts_extracted += 1
                    
                    # 4. Mark as indexed
                    now = datetime.now(tz=timezone.utc).timestamp()
                    await loop.run_in_executor(None, self._update_indexed_at, store, note["id"], now)
                    reindexed_count += 1
                    
                except Exception as e:
                    logger.warning("Scribe: failed to process note %s: %s", vpath, e)
                    continue

            logger.info("Scribe scan: %d notes checked, %d re-indexed, %d facts extracted.", 
                        checked_count, reindexed_count, facts_extracted)

        except Exception as e:
            logger.error("Scribe heuristic scan failed: %s", e)

    def _get_stale_notes(self, store) -> list:
        conn = store._get_conn()
        rows = conn.execute(
            "SELECT * FROM vault_notes WHERE indexed_at < mtime OR indexed_at IS NULL"
        ).fetchall()
        return [dict(r) for r in rows]

    def _update_indexed_at(self, store, note_id: int, ts: float):
        conn = store._get_conn()
        conn.execute("UPDATE vault_notes SET indexed_at = ? WHERE id = ?", (ts, note_id))
        conn.commit()

    async def _extract_facts_from_note(self, llm, content: str) -> list[dict]:
        """Use LLM to extract facts from note content."""
        prompt = (
            "Extract key facts or preferences from this markdown note. "
            "Return a JSON list of objects with 'key' and 'value'. "
            "Keys should be snake_case (e.g. 'favorite_color', 'work_schedule'). "
            "If no facts found, return [].\n\n"
            f"--- NOTE CONTENT ---\n{content}\n--- END ---"
        )
        
        try:
            full = ""
            async for chunk in llm.stream_response([
                {"role": "system", "content": "You are a precise fact extractor. Output JSON only."},
                {"role": "user", "content": prompt}
            ]):
                full += chunk
            
            # Basic JSON cleanup/parsing
            import json, re
            match = re.search(r"\[.*\]", full, re.DOTALL)
            if match:
                return json.loads(match.group(0))
            return []
        except (json.JSONDecodeError, ValueError) as e:
            logger.debug("Scribe: fact extraction JSON parse failed: %s", e)
            return []
        except Exception as e:
            logger.warning("Scribe: fact extraction failed: %s", e)
            return []

    async def _analyze_note(self, virtual_path: str) -> dict:
        """Deep analysis of a single note."""
        logger.info("Scribe: analyzing note %s", virtual_path)
        # This would be called on-demand or by the main loop.
        return {"status": "analyzed", "path": virtual_path}
