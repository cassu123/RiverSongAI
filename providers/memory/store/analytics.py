# =============================================================================
# providers/memory/store/analytics.py
#
# File Purpose:
#   Pulse snapshots, voice-ID events, analytics platforms/snapshots, push and FCM tokens.
#   AnalyticsStoreMixin is mixed into SQLiteStore; all methods were moved
#   verbatim from providers/memory/sqlite_store.py.
# =============================================================================

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from providers.memory.store._util import (
    _now_str,
)


class AnalyticsStoreMixin:
    """Pulse snapshots, voice-ID events, analytics platforms/snapshots, push and FCM tokens.

    Mixin for SQLiteStore: relies on self._run / self._get_conn from the
    host class and defines no __init__ of its own.
    """

    # -------------------------------------------------------------------------
    # Pulse Snapshots
    # -------------------------------------------------------------------------

    async def save_pulse_snapshot(self, source: str, data: dict) -> None:
        # High-volume periodic snapshots run on the isolated writer so they
        # cannot starve the shared pool used by memory/auth reads.
        now = datetime.now(tz=timezone.utc).timestamp()
        await self.execute_write_isolated_async(
            "INSERT INTO pulse_snapshots (source, data_json, ts) VALUES (?, ?, ?)",
            (source, json.dumps(data), now),
        )

    async def get_latest_pulse_snapshot(self, source: str) -> Optional[dict]:
        return await self._run(self._sync_get_latest_pulse_snapshot, source)

    def _sync_get_latest_pulse_snapshot(self, source: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM pulse_snapshots WHERE source = ? ORDER BY ts DESC LIMIT 1",
            (source,)
        ).fetchone()
        if not row:
            return None
        return {
            "source": row["source"],
            "data": json.loads(row["data_json"]),
            "ts": row["ts"]
        }

    async def prune_pulse_snapshots(self, source: str, keep: int = 100) -> int:
        return await self._run(self._sync_prune_pulse_snapshots, source, keep)

    def _sync_prune_pulse_snapshots(self, source: str, keep: int) -> int:
        conn = self._get_conn()
        # Delete rows not in the top N recent for this source
        res = conn.execute(
            """
            DELETE FROM pulse_snapshots
            WHERE source = ?
            AND id NOT IN (
                SELECT id FROM pulse_snapshots
                WHERE source = ?
                ORDER BY ts DESC
                LIMIT ?
            )
            """,
            (source, source, keep)
        )
        conn.commit()
        return res.rowcount

    # -------------------------------------------------------------------------
    # Voice ID Events
    # -------------------------------------------------------------------------

    async def log_voice_id_event(
        self,
        ts: float,
        identified_user_id: Optional[str],
        score: Optional[float],
        runner_up_user_id: Optional[str],
        runner_up_score: Optional[float],
        audio_duration_ms: int,
        session_kind: str,
    ) -> None:
        await self._run(
            self._sync_log_voice_id_event,
            ts,
            identified_user_id,
            score,
            runner_up_user_id,
            runner_up_score,
            audio_duration_ms,
            session_kind,
        )

    def _sync_log_voice_id_event(
        self,
        ts: float,
        identified_user_id: Optional[str],
        score: Optional[float],
        runner_up_user_id: Optional[str],
        runner_up_score: Optional[float],
        audio_duration_ms: int,
        session_kind: str,
    ) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO voice_id_events (
                ts, identified_user_id, score, runner_up_user_id, runner_up_score,
                audio_duration_ms, session_kind
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ts, identified_user_id, score, runner_up_user_id, runner_up_score,
                audio_duration_ms, session_kind
            )
        )
        conn.commit()

    async def get_recent_voice_id_events(self, limit: int = 50) -> list[dict]:
        return await self._run(self._sync_get_recent_voice_id_events, limit)

    def _sync_get_recent_voice_id_events(self, limit: int) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM voice_id_events ORDER BY ts DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    # -------------------------------------------------------------------------
    # Analytics — platforms
    # -------------------------------------------------------------------------

    async def get_analytics_platforms(self, user_id: str) -> list[dict]:
        return await self._run(self._sync_get_analytics_platforms, user_id)

    def _sync_get_analytics_platforms(self, user_id: str) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM analytics_platforms WHERE user_id=? ORDER BY platform",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    async def upsert_analytics_platform(
        self, user_id: str, platform: str, enabled: bool,
        api_key: str = "", api_secret: str = "", notes: str = "",
    ) -> None:
        await self._run(
            self._sync_upsert_analytics_platform,
            user_id, platform, enabled, api_key, api_secret, notes,
        )

    def _sync_upsert_analytics_platform(
        self, user_id: str, platform: str, enabled: bool,
        api_key: str, api_secret: str, notes: str,
    ) -> None:
        conn = self._get_conn()
        now = _now_str()
        existing = conn.execute(
            "SELECT id FROM analytics_platforms WHERE user_id=? AND platform=?",
            (user_id, platform),
        ).fetchone()
        if existing:
            conn.execute(
                """UPDATE analytics_platforms SET enabled=?, api_key=?, api_secret=?,
                   notes=?, updated_at=? WHERE user_id=? AND platform=?""",
                (int(enabled), api_key, api_secret, notes, now, user_id, platform),
            )
        else:
            conn.execute(
                """INSERT INTO analytics_platforms
                   (id, user_id, platform, enabled, api_key, api_secret, notes, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (str(uuid.uuid4()), user_id, platform, int(enabled),
                 api_key, api_secret, notes, now, now),
            )
        conn.commit()

    async def delete_analytics_platform(
            self, user_id: str, platform: str) -> None:
        await self._run(self._sync_delete_analytics_platform, user_id, platform)

    def _sync_delete_analytics_platform(
            self, user_id: str, platform: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM analytics_platforms WHERE user_id=? AND platform=?",
            (user_id, platform),
        )
        conn.commit()

    # -------------------------------------------------------------------------
    # Analytics — snapshots
    # -------------------------------------------------------------------------

    async def get_analytics_snapshots(
        self, user_id: str, platform: Optional[str] = None, days: int = 90,
    ) -> list[dict]:
        return await self._run(self._sync_get_analytics_snapshots, user_id, platform, days)

    def _sync_get_analytics_snapshots(
        self, user_id: str, platform: Optional[str], days: int,
    ) -> list[dict]:
        conn = self._get_conn()
        if platform:
            rows = conn.execute(
                """SELECT * FROM analytics_snapshots
                   WHERE user_id=? AND platform=?
                     AND date >= date('now', ?)
                   ORDER BY platform, date""",
                (user_id, platform, f"-{days} days"),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM analytics_snapshots
                   WHERE user_id=?
                     AND date >= date('now', ?)
                   ORDER BY platform, date""",
                (user_id, f"-{days} days"),
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["metrics"] = json.loads(d["metrics"])
            except (json.JSONDecodeError, TypeError):
                d["metrics"] = {}
            result.append(d)
        return result

    async def upsert_analytics_snapshot(
        self, user_id: str, platform: str, date: str, metrics: dict,
    ) -> str:
        return await self._run(
            self._sync_upsert_analytics_snapshot, user_id, platform, date, metrics,
        )

    def _sync_upsert_analytics_snapshot(
        self, user_id: str, platform: str, date: str, metrics: dict,
    ) -> str:
        conn = self._get_conn()
        now = _now_str()
        existing = conn.execute(
            "SELECT id FROM analytics_snapshots WHERE user_id=? AND platform=? AND date=?",
            (user_id, platform, date),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE analytics_snapshots SET metrics=?, updated_at=? WHERE id=?",
                (json.dumps(metrics), now, existing[0]),
            )
            conn.commit()
            return existing[0]
        snap_id = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO analytics_snapshots
               (id, user_id, platform, date, metrics, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?)""",
            (snap_id, user_id, platform, date, json.dumps(metrics), now, now),
        )
        conn.commit()
        return snap_id

    async def delete_analytics_snapshot(
            self, snapshot_id: str, user_id: str) -> None:
        await self._run(self._sync_delete_analytics_snapshot, snapshot_id, user_id)

    def _sync_delete_analytics_snapshot(
            self, snapshot_id: str, user_id: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM analytics_snapshots WHERE id=? AND user_id=?",
            (snapshot_id, user_id),
        )
        conn.commit()

    # -------------------------------------------------------------------------
    # Web Push Notifications
    # -------------------------------------------------------------------------

    async def save_push_subscription(
            self, user_id: str, subscription_json: str) -> None:
        await self._run(self._sync_save_push_subscription, user_id, subscription_json)

    def _sync_save_push_subscription(
            self, user_id: str, subscription_json: str) -> None:
        import json
        conn = self._get_conn()
        sub = json.loads(subscription_json)
        endpoint = sub["endpoint"]
        now = _now_str()
        conn.execute(
            """
            INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, endpoint) DO UPDATE SET
                subscription_json = excluded.subscription_json
            """,
            (user_id, endpoint, subscription_json, now),
        )
        conn.commit()

    async def get_push_subscriptions(self, user_id: str) -> list[str]:
        return await self._run(self._sync_get_push_subscriptions, user_id)

    def _sync_get_push_subscriptions(self, user_id: str) -> list[str]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT subscription_json FROM push_subscriptions WHERE user_id=?",
            (user_id,),
        ).fetchall()
        return [row[0] for row in rows]

    async def delete_push_subscription(
            self, user_id: str, endpoint: str) -> None:
        await self._run(self._sync_delete_push_subscription, user_id, endpoint)

    def _sync_delete_push_subscription(
            self, user_id: str, endpoint: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?",
            (user_id, endpoint),
        )
        conn.commit()

    # -------------------------------------------------------------------------
    # FCM tokens (Capacitor native app)
    # -------------------------------------------------------------------------
    async def save_fcm_token(
            self, user_id: str, token: str, platform: str = "android") -> None:
        await self._run(self._sync_save_fcm_token, user_id, token, platform)

    def _sync_save_fcm_token(
            self, user_id: str, token: str, platform: str) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO fcm_tokens (user_id, token, platform, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, token) DO UPDATE SET
                platform = excluded.platform
            """,
            (user_id, token, platform, _now_str()),
        )
        conn.commit()

    async def get_fcm_tokens(self, user_id: str) -> list[str]:
        return await self._run(self._sync_get_fcm_tokens, user_id)

    def _sync_get_fcm_tokens(self, user_id: str) -> list[str]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT token FROM fcm_tokens WHERE user_id=?",
            (user_id,),
        ).fetchall()
        return [row[0] for row in rows]

    async def delete_fcm_token(self, user_id: str, token: str) -> None:
        await self._run(self._sync_delete_fcm_token, user_id, token)

    def _sync_delete_fcm_token(self, user_id: str, token: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM fcm_tokens WHERE user_id=? AND token=?",
            (user_id, token),
        )
        conn.commit()
