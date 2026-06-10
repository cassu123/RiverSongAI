"""
providers/vault/vault_provider.py

Backend provider for CHRONOS local markdown vault.
Handles file operations, virtual path resolution, and filesystem watching.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from config.settings import get_settings
from core.family import resolve_module_owner

logger = logging.getLogger(__name__)

# Root keys for the virtual tree
VROOT_PERSONAL = "personal"
VROOT_HOUSEHOLD = "household"
VROOT_SHARED = "shared"


class VaultProvider:
    """
    Handles file operations for CHRONOS.
    Resolves virtual paths to physical paths and enforces security boundaries.
    """

    def __init__(self, store: Optional[Any] = None) -> None:
        self.settings = get_settings()
        self.base_vault = Path(self.settings.db_path).parent / "vault"
        self.store = store

        # Ensure base directories exist
        os.makedirs(self.base_vault / "users", exist_ok=True)
        os.makedirs(self.base_vault / "households", exist_ok=True)
        os.makedirs(self.base_vault / ".trash", exist_ok=True)

    def _get_roots(self, user_id: str) -> Dict[str, Path]:
        """Resolve physical paths for a user's allowed roots."""
        personal = self.base_vault / "users" / user_id

        # Resolve household root
        # resolve_module_owner returns 'family:<id>' or user_id
        owner_id = resolve_module_owner(user_id, "vault")
        if owner_id.startswith("family:"):
            family_id = owner_id.split(":")[1]
            household = self.base_vault / "households" / family_id
        else:
            household = None  # No household shared or user not in group

        roots = {VROOT_PERSONAL: personal}
        if household:
            roots[VROOT_HOUSEHOLD] = household

        # Shared with me is Phase 2+ or deferred? A.1 mentions it.
        # For Phase 1, we'll just have Personal and Household.
        return roots

    def _resolve_virtual(self, user_id: str, virtual_path: str) -> Path:
        """
        Convert "personal/folder/note.md" to physical path.
        Enforces path traversal protection.
        """
        roots = self._get_roots(user_id)
        parts = virtual_path.split("/", 1)
        root_key = parts[0].lower()
        sub_path = parts[1] if len(parts) > 1 else ""

        if root_key not in roots:
            raise PermissionError(
                f"Root '{root_key}' not found or access denied.")

        root_path = roots[root_key]
        os.makedirs(root_path, exist_ok=True)

        unresolved = root_path / sub_path
        target = unresolved.resolve()

        # Security: must be inside the root. is_relative_to avoids the
        # string-prefix pitfall where /vault/alice-evil matches /vault/alice.
        if not target.is_relative_to(root_path.resolve()):
            raise PermissionError("Access denied: path traversal detected.")

        # Security: reject symlinks anywhere under the root so a link created
        # inside one vault can never point at another user's files.
        probe = unresolved
        while probe != root_path and probe != probe.parent:
            if probe.is_symlink():
                raise PermissionError("Access denied: symlinks are not permitted in the vault.")
            probe = probe.parent

        return target

    def _to_virtual(self, user_id: str, physical_path: Path) -> str:
        """Convert a physical path back to a virtual path."""
        roots = self._get_roots(user_id)
        p_resolved = physical_path.resolve()

        for v_prefix, p_root in roots.items():
            r_resolved = p_root.resolve()
            if str(p_resolved).startswith(str(r_resolved)):
                rel = p_resolved.relative_to(r_resolved)
                return f"{v_prefix}/{rel}" if str(rel) != "." else v_prefix

        return str(physical_path)

    async def list_tree(self, user_id: str, root_key: str) -> list[dict]:
        """Recursive directory listing for a specific root."""
        roots = self._get_roots(user_id)
        root_key = root_key.lower()
        if root_key not in roots:
            return []

        root_path = roots[root_key]
        if not root_path.exists():
            return []

        def _scan(current_path: Path) -> list[dict]:
            items = []
            for p in current_path.iterdir():
                if p.name.startswith("."):
                    continue  # skip hidden

                is_dir = p.is_dir()
                stat = p.stat()
                items.append({
                    "name": p.name,
                    "path": self._to_virtual(user_id, p),
                    "is_dir": is_dir,
                    "size": stat.st_size if not is_dir else 0,
                    "mtime": stat.st_mtime,
                    "children": _scan(p) if is_dir else None
                })
            return sorted(items, key=lambda x: (
                not x["is_dir"], x["name"].lower()))

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _scan, root_path)

    async def read_note(self, user_id: str, virtual_path: str) -> str:
        target = self._resolve_virtual(user_id, virtual_path)
        if not target.is_file():
            raise FileNotFoundError(f"Note not found: {virtual_path}")

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, target.read_text, "utf-8")

    async def write_note(self, user_id: str,
                         virtual_path: str, content: str) -> dict:
        target = self._resolve_virtual(user_id, virtual_path)
        os.makedirs(target.parent, exist_ok=True)

        def _atomic_write():
            tmp = target.with_suffix(".tmp")
            tmp.write_text(content, encoding="utf-8")
            os.replace(tmp, target)
            stat = target.stat()
            return {"mtime": stat.st_mtime, "size": stat.st_size}

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, _atomic_write)

        if self.store:
            await self.store.log_vault_audit(user_id, "WRITE", virtual_path)

        return result

    async def append_to_note(
        self,
        user_id: str,
        virtual_path: str,
        appended: str,
        default_template: str = "",
    ) -> dict:
        """
        Append text to a note, creating it from ``default_template`` if missing.
        Used by daily-notes and any feature that streams entries into a log.
        """
        try:
            existing = await self.read_note(user_id, virtual_path)
        except FileNotFoundError:
            existing = default_template
        body = existing
        if body and not body.endswith("\n"):
            body += "\n"
        body += appended
        return await self.write_note(user_id, virtual_path, body)

    async def get_or_create_daily_note(
        self,
        user_id: str,
        date_str: Optional[str] = None,
    ) -> dict:
        """
        Read today's (or ``date_str``'s) daily note, creating an empty
        templated note if it doesn't yet exist. Returns
        ``{virtual_path, date, content}``.
        """
        if not date_str:
            date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        virtual_path = f"{VROOT_PERSONAL}/Daily/{date_str}.md"
        template = (
            f"---\ndate: {date_str}\nkind: daily\n---\n\n"
            f"# {date_str}\n\n"
        )
        try:
            content = await self.read_note(user_id, virtual_path)
        except FileNotFoundError:
            await self.write_note(user_id, virtual_path, template)
            content = template
        return {"virtual_path": virtual_path,
                "date": date_str, "content": content}

    async def append_to_daily(
        self,
        user_id: str,
        section_title: str,
        body: str,
        date_str: Optional[str] = None,
    ) -> dict:
        """
        Append a timestamped section to today's (or ``date_str``'s) daily note.
        """
        if not date_str:
            date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        virtual_path = f"{VROOT_PERSONAL}/Daily/{date_str}.md"
        template = (
            f"---\ndate: {date_str}\nkind: daily\n---\n\n"
            f"# {date_str}\n\n"
        )
        hhmm = datetime.now(timezone.utc).strftime("%H:%M UTC")
        entry = f"\n## {hhmm} — {section_title}\n\n{body.strip()}\n"
        return await self.append_to_note(user_id, virtual_path, entry, default_template=template)

    async def delete_note(self, user_id: str, virtual_path: str) -> None:
        target = self._resolve_virtual(user_id, virtual_path)
        if not target.exists():
            return

        trash_dir = self.base_vault / ".trash" / user_id
        os.makedirs(trash_dir, exist_ok=True)

        timestamp = int(time.time())
        dest = trash_dir / f"{timestamp}-{target.name}"

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, os.replace, target, dest)

        if self.store:
            await self.store.log_vault_audit(user_id, "DELETE", virtual_path)

    async def rename_note(self, user_id: str, old_vpath: str,
                          new_vpath: str) -> dict:
        old_target = self._resolve_virtual(user_id, old_vpath)
        new_target = self._resolve_virtual(user_id, new_vpath)

        # Cross-root moves return 400 (per A.2.1)
        # We can check by seeing if they resolved to the same base root folder
        roots = self._get_roots(user_id)
        old_root = next((r for r in roots.values() if str(
            old_target.resolve()).startswith(str(r.resolve()))), None)
        new_root = next((r for r in roots.values() if str(
            new_target.resolve()).startswith(str(r.resolve()))), None)

        if old_root != new_root:
            # We'll raise a ValueError and let the route handle it as 400
            raise ValueError("Cross-root renames are not allowed.")

        if not old_target.exists():
            raise FileNotFoundError(f"Source not found: {old_vpath}")

        os.makedirs(new_target.parent, exist_ok=True)

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, os.rename, old_target, new_target)

        stat = new_target.stat()
        if self.store:
            await self.store.log_vault_audit(user_id, "RENAME", f"{old_vpath} -> {new_vpath}")

        return {"mtime": stat.st_mtime, "size": stat.st_size}

    async def search_text(self, user_id: str, query: str,
                          limit: int = 50) -> list[dict]:
        """Substring search over filename AND content."""
        if not self.store:
            return []

        # 1. Start with metadata search from DB
        meta_results = await self.store.search_vault_notes(user_id, query, limit)

        # 2. Augment with basic content grep
        results = {r["virtual_path"]: r for r in meta_results}

        # Use the same roots resolution as the rest of the provider
        user_roots = self._get_roots(user_id)

        for v_prefix, root_path in user_roots.items():
            if not root_path.exists():
                continue
            for p in root_path.rglob("*.md"):
                v_path = self._to_virtual(user_id, p)
                if v_path in results:
                    continue

                try:
                    stat = p.stat()
                    if stat.st_size > 1_048_576:  # 1MB limit
                        logger.debug("search_text: skipping large file %s", p)
                        continue

                    content = p.read_text("utf-8")
                    if query.lower() in content.lower():
                        results[v_path] = {
                            "virtual_path": v_path,
                            "title": p.stem,
                        }
                except (OSError, UnicodeDecodeError) as e:
                    logger.debug("search_text: failed to read %s: %s", p, e)
                    continue
                except Exception as e:
                    logger.warning(
                        "search_text: unexpected error reading %s: %s", p, e)
                    continue

                if len(results) >= limit:
                    break
            if len(results) >= limit:
                break

        return list(results.values())[:limit]

    async def get_backlinks(self, user_id: str,
                            virtual_path: str) -> list[dict]:
        if not self.store:
            return []
        note = await self.store.get_vault_note_by_path(virtual_path)
        if not note or not note.get("title"):
            return []
        return await self.list_vault_backlinks(note["title"])

    async def list_vault_backlinks(self, title: str) -> list[dict]:
        if not self.store:
            return []
        return await self.store.list_vault_backlinks(title)

    async def get_graph(self, user_id: str) -> dict:
        if not self.store:
            return {"nodes": [], "edges": []}
        return await self.store.get_vault_graph(user_id)


class VaultWatcher(FileSystemEventHandler):
    """
    Watchdog handler that triggers re-indexing in SQLite.
    """

    def __init__(self, provider: VaultProvider,
                 loop: asyncio.AbstractEventLoop) -> None:
        self.provider = provider
        self.loop = loop
        self.debounce_timer: Dict[str, Any] = {}

    def on_any_event(self, event):
        if event.is_directory:
            return
        if event.event_type not in ("created", "modified", "moved"):
            return

        path = event.src_path
        if event.event_type == "moved":
            path = event.dest_path

        if not path.endswith(".md"):
            return

        # We use threadsafe methods because watchdog runs in its own thread
        self.loop.call_soon_threadsafe(self._debounce, path)

    def _debounce(self, path: str):
        if path in self.debounce_timer:
            self.debounce_timer[path].cancel()
        self.debounce_timer[path] = self.loop.call_later(
            0.25, self._trigger_index, path)

    def _trigger_index(self, physical_path: str):
        asyncio.run_coroutine_threadsafe(
            self._index_file(
                Path(physical_path)),
            self.loop)

    async def _index_file(self, p: Path):
        logger.info("Indexing file: %s", p)
        if not self.provider.store:
            logger.warning("No store available for indexing")
            return

        # Determine virtual path and ownership
        parts = p.parts
        vault_idx = -1
        for i, part in enumerate(parts):
            if part == "vault":
                vault_idx = i
                break

        if vault_idx == -1 or len(parts) <= vault_idx + 2:
            return

        kind_dir = parts[vault_idx + 1]  # "users" or "households"
        owner_id = parts[vault_idx + 2]
        owner_kind = "user" if kind_dir == "users" else "household"

        rel_parts = parts[vault_idx + 3:]
        v_prefix = VROOT_PERSONAL if owner_kind == "user" else VROOT_HOUSEHOLD
        virtual_path = "/".join([v_prefix] + list(rel_parts))

        if not p.exists():
            # Likely deleted or moved
            await self.provider.store.delete_vault_note_by_path(virtual_path)
            return

        try:
            content = p.read_text("utf-8")
            title = self._extract_title(content, p.stem)
            links = self._extract_links(content)
            stat = p.stat()

            await self.provider.store.upsert_vault_note(
                owner_kind=owner_kind,
                owner_id=owner_id,
                virtual_path=virtual_path,
                title=title,
                size=stat.st_size,
                mtime=stat.st_mtime,
                links=links
            )

            # Semantic indexing (A.2.2)
            settings = get_settings()
            if settings.semantic_memory_enabled:
                from providers.memory.vector_store import VectorStore
                vstore = VectorStore()
                # We use the virtual path as the ID for note segments
                # For now, we embed the whole note if it's small, or just the title + snippet
                # Actually, Chroma handles documents fine.
                await vstore.upsert(
                    id=f"note:{virtual_path}",
                    text=f"Note: {title}\n\n{content}",
                    metadata={
                        "type": "note",
                        "user_id": owner_id if owner_kind == "user" else "household",
                        "path": virtual_path,
                        "title": title
                    }
                )

        except Exception as e:
            logger.error("Failed to index file %s: %s", p, e)

    def _extract_title(self, content: str, default: str) -> str:
        # Extract first H1
        match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
        if match:
            return match.group(1).strip()
        return default

    def _extract_links(self, content: str) -> list[str]:
        # Regex [[title]] or [[title|alias]]
        links = re.findall(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", content)
        return [l.strip() for l in links]


# Global observer instance
_observer: Optional[Any] = None


def start_vault_watcher(app):
    global _observer
    if _observer:
        return

    settings = get_settings()
    base_vault = Path(settings.db_path).parent / "vault"
    os.makedirs(base_vault, exist_ok=True)

    loop = asyncio.get_running_loop()
    provider = VaultProvider(store=app.state.memory_manager._store)
    handler = VaultWatcher(provider, loop)

    _observer = Observer()
    _observer.schedule(handler, str(base_vault), recursive=True)
    _observer.start()
    logger.info("CHRONOS vault watcher started at %s", base_vault)

    # Initial indexing walk (A.2.2)
    async def _walk():
        logger.info("CHRONOS: Performing initial vault indexing walk...")
        for p in base_vault.rglob("*.md"):
            await handler._index_file(p)
        logger.info("CHRONOS: Initial walk complete.")

    asyncio.create_task(_walk())


def stop_vault_watcher():
    global _observer
    if _observer:
        _observer.stop()
        _observer.join()
        _observer = None
        logger.info("CHRONOS vault watcher stopped.")
