# =============================================================================
# providers/memory/store/_util.py
#
# File Purpose:
#   Module-level helpers shared by the SQLiteStore mixins. Moved verbatim
#   from providers/memory/sqlite_store.py (which re-exports them for
#   backwards compatibility).
# =============================================================================

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import List, Optional


def _dt_to_str(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _str_to_dt(s: Optional[str]) -> Optional[datetime]:
    if s is None:
        return None
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _now_str() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


_SQL_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _safe_cols(keys) -> List[str]:
    """Guard dynamic column names interpolated into SQL.

    Callers allowlist keys upstream, but this is the last line of defense:
    anything that isn't a plain identifier is rejected outright.
    """
    bad = [k for k in keys if not _SQL_IDENT_RE.match(str(k))]
    if bad:
        raise ValueError(f"Unsafe SQL column name(s): {bad}")
    return list(keys)

import typing
if typing.TYPE_CHECKING:
    import sqlite3
    class StoreProtocol(typing.Protocol):
        def _get_conn(self) -> sqlite3.Connection: ...
        async def _run(self, fn: typing.Callable, *args: typing.Any, **kwargs: typing.Any) -> typing.Any: ...
        async def execute_read_async(self, sql: str, params: tuple = ()) -> typing.List[typing.Dict[str, typing.Any]]: ...
        async def execute_read_one_async(self, sql: str, params: tuple = ()) -> typing.Optional[typing.Dict[str, typing.Any]]: ...
        async def execute_write_async(self, sql: str, params: tuple) -> None: ...
        async def execute_write_isolated_async(self, sql: str, params: tuple) -> None: ...
        async def get_admin_config(self) -> dict: ...
        async def set_admin_config(self, config: dict) -> None: ...
else:
    class StoreProtocol: pass
