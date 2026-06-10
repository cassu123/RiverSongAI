import asyncio
import logging
import os
import time
from pathlib import Path
from datetime import datetime, timezone

from daemons.base_daemon import BaseDaemon
from core.token_tracker import set_usage_source
from config.settings import get_settings
from providers.llm.agent_roles import AgentRole, get_role_registry
from providers.memory.graphiti_provider import Episode, get_graphiti_provider

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
            user_id = payload.get("user_id")
            return await self._analyze_note(path, user_id)
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
        set_usage_source("scribe")
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

            # 2. For each stale note, extract facts.
            # Route via the Scribe agent role so the assigned model + tuning live
            # in providers/llm/agent_roles.py (visible in the SLAE admin panel).
            from core.conversation_loop import _build_llm_provider
            role_cfg = get_role_registry().get(AgentRole.SCRIBE)
            llm, _ = _build_llm_provider(
                provider_override=role_cfg.provider,
                model_override=role_cfg.model_id,
            )
            
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

                    # 4. Write a Graphiti episode for cross-runtime recall.
                    # Best-effort; the provider no-ops when disabled and never raises.
                    try:
                        await get_graphiti_provider().add_episode(Episode(
                            group_id="vault",
                            name=f"scribe:{vpath}",
                            episode_body=content[:4000],
                            source="scribe",
                            metadata={
                                "user_id": user_id,
                                "facts_extracted": len(facts) if facts else 0,
                                "virtual_path": vpath,
                            },
                        ))
                    except Exception as ge:
                        logger.debug("Scribe: graphiti episode write skipped: %s", ge)
                    
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
        """Use LLM to extract facts from note content.

        Wraps the call in invocation tracking so the SLAE admin panel can show
        Scribe activity live (success/failure dot + elapsed ms).
        """
        prompt = (
            "Extract key facts or preferences from this markdown note. "
            "Return a JSON list of objects with 'key' and 'value'. "
            "Keys should be snake_case (e.g. 'favorite_color', 'work_schedule'). "
            "If no facts found, return [].\n\n"
            f"--- NOTE CONTENT ---\n{content}\n--- END ---"
        )

        registry = get_role_registry()
        started = time.perf_counter()

        try:
            full = ""
            async for chunk in llm.stream_response([
                {"role": "system", "content": "You are a precise fact extractor. Output JSON only."},
                {"role": "user", "content": prompt}
            ]):
                full += chunk

            import json, re
            match = re.search(r"\[.*\]", full, re.DOTALL)
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            registry.record_invocation(AgentRole.SCRIBE, success=True, elapsed_ms=elapsed_ms)
            if match:
                return json.loads(match.group(0))
            return []
        except (json.JSONDecodeError, ValueError) as e:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            registry.record_invocation(
                AgentRole.SCRIBE, success=False, elapsed_ms=elapsed_ms,
                error=f"json_parse: {e}",
            )
            logger.debug("Scribe: fact extraction JSON parse failed: %s", e)
            return []
        except Exception as e:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            registry.record_invocation(
                AgentRole.SCRIBE, success=False, elapsed_ms=elapsed_ms, error=str(e),
            )
            logger.warning("Scribe: fact extraction failed: %s", e)
            return []

    async def _analyze_note(self, virtual_path: str, user_id: str | None = None) -> dict:
        set_usage_source("scribe")
        """On-demand deep analysis of a single note.

        Same pipeline as the heuristic scan, scoped to one note: read it,
        extract facts via the Scribe-role LLM, persist them, and record a
        Graphiti episode.
        """
        logger.info("Scribe: analyzing note %s", virtual_path)
        if not virtual_path or not user_id:
            return {"error": "analyze_note requires 'path' and 'user_id' in the payload"}

        from main import get_app
        from core.conversation_loop import _build_llm_provider
        from providers.vault.vault_provider import VaultProvider

        app = get_app()
        memory_manager = getattr(app.state, "memory_manager", None) if app else None
        if memory_manager is None:
            return {"error": "memory manager not available"}

        try:
            v_prov = VaultProvider(store=memory_manager._store)
            content = await v_prov.read_note(user_id, virtual_path)
        except (PermissionError, FileNotFoundError) as exc:
            return {"error": f"cannot read note: {exc}"}
        if not content:
            return {"status": "analyzed", "path": virtual_path, "facts_extracted": 0}

        role_cfg = get_role_registry().get(AgentRole.SCRIBE)
        llm, _ = _build_llm_provider(
            provider_override=role_cfg.provider,
            model_override=role_cfg.model_id,
        )
        facts = await self._extract_facts_from_note(llm, content)
        for f in facts:
            await memory_manager.upsert_fact(
                user_id=user_id,
                key=f["key"],
                value=f["value"],
                source="scribe",
            )

        try:
            await get_graphiti_provider().add_episode(Episode(
                group_id="vault",
                name=f"scribe:{virtual_path}",
                episode_body=content[:4000],
                source="scribe",
                metadata={
                    "user_id": user_id,
                    "facts_extracted": len(facts),
                    "virtual_path": virtual_path,
                },
            ))
        except Exception as ge:
            logger.debug("Scribe: graphiti episode write skipped: %s", ge)

        return {
            "status": "analyzed",
            "path": virtual_path,
            "facts_extracted": len(facts),
        }
