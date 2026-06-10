# =============================================================================
# providers/memory/store/settings.py
#
# File Purpose:
#   Memory/LLM/user settings, feed and page preferences, admin config.
#   SettingsStoreMixin is mixed into SQLiteStore; all methods were moved
#   verbatim from providers/memory/sqlite_store.py.
# =============================================================================

from __future__ import annotations

import json

from providers.memory.models import (
    LLMSettings,
    MemorySettings,
    UserPreferences,
)
from providers.memory.store._util import (
    _now_str,
)


class SettingsStoreMixin:
    """Memory/LLM/user settings, feed and page preferences, admin config.

    Mixin for SQLiteStore: relies on self._run / self._get_conn from the
    host class and defines no __init__ of its own.
    """
    # -------------------------------------------------------------------------
    # Memory settings
    # -------------------------------------------------------------------------

    async def get_memory_settings(self, user_id: str) -> MemorySettings:
        """Fetch settings for user, or return defaults if not yet saved."""
        return await self._run(self._sync_get_memory_settings, user_id)

    def _sync_get_memory_settings(self, user_id: str) -> MemorySettings:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM memory_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return MemorySettings(user_id=user_id)
        return MemorySettings(
            user_id=row["user_id"],
            summaries_enabled=bool(row["summaries_enabled"]),
            default_ttl=row["default_ttl"],
            auto_extend=bool(row["auto_extend"]),
        )

    async def save_memory_settings(self, settings: MemorySettings) -> None:
        await self._run(self._sync_save_memory_settings, settings)

    def _sync_save_memory_settings(self, settings: MemorySettings) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO memory_settings
                (user_id, summaries_enabled, default_ttl, auto_extend)
            VALUES (:user_id, :summaries_enabled, :default_ttl, :auto_extend)
            ON CONFLICT(user_id) DO UPDATE SET
                summaries_enabled = excluded.summaries_enabled,
                default_ttl       = excluded.default_ttl,
                auto_extend       = excluded.auto_extend
            """,
            {
                "user_id": settings.user_id,
                "summaries_enabled": int(settings.summaries_enabled),
                "default_ttl": settings.default_ttl,
                "auto_extend": int(settings.auto_extend),
            },
        )
        conn.commit()

    # -------------------------------------------------------------------------
    # LLM settings
    # -------------------------------------------------------------------------

    async def get_llm_settings(self, user_id: str) -> LLMSettings:
        """Fetch LLM settings for user, or return defaults (ollama / llama3.2:3b)."""
        return await self._run(self._sync_get_llm_settings, user_id)

    def _sync_get_llm_settings(self, user_id: str) -> LLMSettings:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM llm_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return LLMSettings(user_id=user_id)
        return LLMSettings(
            user_id=row["user_id"],
            provider=row["provider"],
            model=row["model"],
            cloud_fallback_enabled=bool(row["cloud_fallback_enabled"]),
            cloud_fallback_provider=row["cloud_fallback_provider"],
            cloud_fallback_model=row["cloud_fallback_model"],
            voice_id=row["voice_id"] if "voice_id" in row.keys() else "river",
            whisper_model=row["whisper_model"] if "whisper_model" in row.keys(
            ) else "base",
        )

    async def save_llm_settings(self, settings: LLMSettings) -> None:
        await self._run(self._sync_save_llm_settings, settings)

    def _sync_save_llm_settings(self, settings: LLMSettings) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO llm_settings
                (user_id, provider, model, cloud_fallback_enabled,
                 cloud_fallback_provider, cloud_fallback_model, voice_id, whisper_model)
            VALUES
                (:user_id, :provider, :model, :cloud_fallback_enabled,
                 :cloud_fallback_provider, :cloud_fallback_model, :voice_id, :whisper_model)
            ON CONFLICT(user_id) DO UPDATE SET
                provider                = excluded.provider,
                model                   = excluded.model,
                cloud_fallback_enabled  = excluded.cloud_fallback_enabled,
                cloud_fallback_provider = excluded.cloud_fallback_provider,
                cloud_fallback_model    = excluded.cloud_fallback_model,
                voice_id                = excluded.voice_id,
                whisper_model           = excluded.whisper_model
            """,
            {
                "user_id": settings.user_id,
                "provider": settings.provider,
                "model": settings.model,
                "cloud_fallback_enabled": int(settings.cloud_fallback_enabled),
                "cloud_fallback_provider": settings.cloud_fallback_provider,
                "cloud_fallback_model": settings.cloud_fallback_model,
                "voice_id": settings.voice_id,
                "whisper_model": settings.whisper_model,
            },
        )
        conn.commit()
    # -------------------------------------------------------------------------
    # User Preferences
    # -------------------------------------------------------------------------

    async def get_user_preferences(self, user_id: str) -> UserPreferences:
        """Fetch general user preferences, or return defaults."""
        return await self._run(self._sync_get_user_preferences, user_id)

    def _sync_get_user_preferences(self, user_id: str) -> UserPreferences:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM user_preferences WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return UserPreferences(user_id=user_id)
        return UserPreferences(
            user_id=row["user_id"],
            music_provider=row["music_provider"],
        )

    async def save_user_preferences(self, prefs: UserPreferences) -> None:
        """Persist general user preferences."""
        await self._run(self._sync_save_user_preferences, prefs)

    def _sync_save_user_preferences(self, prefs: UserPreferences) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO user_preferences (user_id, music_provider, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                music_provider = excluded.music_provider,
                updated_at     = excluded.updated_at
            """,
            (prefs.user_id, prefs.music_provider, _now_str()),
        )
        conn.commit()


    # =========================================================================
    # Feed preferences
    # =========================================================================

    async def get_feed_preferences(self, user_id: str) -> dict:
        return await self._run(self._sync_get_feed_preferences, user_id)

    def _sync_get_feed_preferences(self, user_id: str) -> dict:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM feed_preferences WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row is None:
            return {
                "user_id": user_id,
                "news_sources": [],
                "weather_lat": None,
                "weather_lon": None,
                "weather_unit": "celsius",
                "sport_teams": [],
                "stock_tickers": [],
                "refresh_news_min": 30,
                "refresh_weather_min": 30,
                "refresh_sports_min": 60,
                "refresh_stocks_min": 60,
            }
        base = {
            "user_id": row["user_id"],
            "news_sources": json.loads(row["news_sources"] or "[]"),
            "weather_lat": row["weather_lat"],
            "weather_lon": row["weather_lon"],
            "weather_unit": row["weather_unit"],
            "sport_teams": json.loads(row["sport_teams"] or "[]"),
            "sports_favorite_leagues": json.loads(row["sports_favorite_leagues"] if "sports_favorite_leagues" in row.keys() else '["nba","nfl","mlb"]') or ["nba", "nfl", "mlb"],
            "stock_tickers": json.loads(row["stock_tickers"] or "[]"),
            "refresh_news_min": row["refresh_news_min"],
            "refresh_weather_min": row["refresh_weather_min"],
            "refresh_sports_min": row["refresh_sports_min"],
            "refresh_stocks_min": row["refresh_stocks_min"],
        }

        # Merge fields that have no dedicated column. They live under
        # settings_json.feeds.* so new pref flags can be added without DDL.
        try:
            settings = json.loads(row["settings_json"] or "{}") or {}
        except (json.JSONDecodeError, ValueError, IndexError):
            settings = {}
        feeds_extra = settings.get("feeds") or {}
        for key in (
            "feed_news_enabled",
            "feed_weather_enabled",
            "feed_sports_enabled",
            "feed_stocks_enabled",
            "feed_flights_enabled",
            "weather_alerts_enabled",
            "sports_news_sources",
        ):
            if key in feeds_extra:
                base[key] = feeds_extra[key]
        return base

    async def save_feed_preferences(self, user_id: str, prefs: dict) -> None:
        await self._run(self._sync_save_feed_preferences, user_id, prefs)

    # =========================================================================
    # Generic per-page settings (settings_json column on feed_preferences)
    # =========================================================================

    async def get_page_settings(self, user_id: str) -> dict:
        return await self._run(self._sync_get_page_settings, user_id)

    def _sync_get_page_settings(self, user_id: str) -> dict:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT settings_json FROM feed_preferences WHERE user_id = ?", (
                user_id,)
        ).fetchone()
        if row is None:
            return {}
        try:
            return json.loads(row["settings_json"] or "{}") or {}
        except (json.JSONDecodeError, ValueError):
            return {}

    async def save_page_settings(self, user_id: str, patch: dict) -> None:
        await self._run(self._sync_save_page_settings, user_id, patch)

    def _sync_save_page_settings(self, user_id: str, patch: dict) -> None:
        conn = self._get_conn()
        conn.execute(
            """INSERT OR IGNORE INTO feed_preferences
               (user_id, news_sources, weather_unit, sport_teams,
                sports_favorite_leagues, stock_tickers,
                refresh_news_min, refresh_weather_min,
                refresh_sports_min, refresh_stocks_min, updated_at)
               VALUES (?, '[]', 'celsius', '[]', '["nba","nfl","mlb"]',
                       '[]', 30, 30, 60, 60, ?)""",
            (user_id, _now_str()),
        )
        row = conn.execute(
            "SELECT settings_json FROM feed_preferences WHERE user_id = ?", (
                user_id,)
        ).fetchone()
        try:
            current = json.loads(row["settings_json"] or "{}") or {}
        except (json.JSONDecodeError, ValueError):
            current = {}
        for key, val in patch.items():
            if isinstance(val, dict) and isinstance(current.get(key), dict):
                current[key] = {**current[key], **val}
            else:
                current[key] = val
        conn.execute(
            "UPDATE feed_preferences SET settings_json = ?, updated_at = ? WHERE user_id = ?",
            (json.dumps(current), _now_str(), user_id),
        )
        conn.commit()

    def _sync_save_feed_preferences(self, user_id: str, prefs: dict) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO feed_preferences
                (user_id, news_sources, weather_lat, weather_lon, weather_unit,
                 sport_teams, sports_favorite_leagues, stock_tickers,
                 refresh_news_min, refresh_weather_min,
                 refresh_sports_min, refresh_stocks_min, updated_at)
            VALUES
                (:user_id, :news_sources, :weather_lat, :weather_lon, :weather_unit,
                 :sport_teams, :sports_favorite_leagues, :stock_tickers,
                 :refresh_news_min, :refresh_weather_min,
                 :refresh_sports_min, :refresh_stocks_min, :updated_at)
            ON CONFLICT(user_id) DO UPDATE SET
                news_sources              = excluded.news_sources,
                weather_lat               = excluded.weather_lat,
                weather_lon               = excluded.weather_lon,
                weather_unit              = excluded.weather_unit,
                sport_teams               = excluded.sport_teams,
                sports_favorite_leagues   = excluded.sports_favorite_leagues,
                stock_tickers             = excluded.stock_tickers,
                refresh_news_min          = excluded.refresh_news_min,
                refresh_weather_min       = excluded.refresh_weather_min,
                refresh_sports_min        = excluded.refresh_sports_min,
                refresh_stocks_min        = excluded.refresh_stocks_min,
                updated_at                = excluded.updated_at
            """,
            {
                "user_id": user_id,
                "news_sources": json.dumps(prefs.get("news_sources", [])),
                "weather_lat": prefs.get("weather_lat"),
                "weather_lon": prefs.get("weather_lon"),
                "weather_unit": prefs.get("weather_unit", "celsius"),
                "sport_teams": json.dumps(prefs.get("sport_teams", [])),
                "sports_favorite_leagues": json.dumps(prefs.get("sports_favorite_leagues", ["nba", "nfl", "mlb"])),
                "stock_tickers": json.dumps(prefs.get("stock_tickers", [])),
                "refresh_news_min": prefs.get("refresh_news_min", 30),
                "refresh_weather_min": prefs.get("refresh_weather_min", 30),
                "refresh_sports_min": prefs.get("refresh_sports_min", 60),
                "refresh_stocks_min": prefs.get("refresh_stocks_min", 60),
                "updated_at": _now_str(),
            },
        )

        # Persist non-column-backed fields under settings_json.feeds.
        # The `feed_preferences` table only has columns for the 12 prefs above,
        # so master toggles + alerts + sports-news sources used to silently
        # vanish on save. Storing them as JSON keeps the schema stable when
        # future pref flags are added.
        feeds_patch = {
            k: prefs[k]
            for k in (
                "feed_news_enabled",
                "feed_weather_enabled",
                "feed_sports_enabled",
                "feed_stocks_enabled",
                "feed_flights_enabled",
                "weather_alerts_enabled",
                "sports_news_sources",
            )
            if k in prefs
        }
        if feeds_patch:
            row = conn.execute(
                "SELECT settings_json FROM feed_preferences WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            try:
                current = json.loads(
                    row["settings_json"] or "{}") or {} if row else {}
            except (json.JSONDecodeError, ValueError):
                current = {}
            existing_feeds = current.get("feeds") if isinstance(
                current.get("feeds"), dict) else {}
            current["feeds"] = {
                **existing_feeds,  # type: ignore
                **feeds_patch}  # type: ignore
            conn.execute(
                "UPDATE feed_preferences SET settings_json = ? WHERE user_id = ?",
                (json.dumps(current), user_id),
            )

        conn.commit()

    # =========================================================================
    # Admin config (global, single-row JSON store)
    # =========================================================================

    async def get_admin_config(self) -> dict:
        return await self._run(self._sync_get_admin_config)

    def _sync_get_admin_config(self) -> dict:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT value FROM admin_config WHERE key = '__global__'"
        ).fetchone()
        if not row:
            return {}
        try:
            return json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return {}

    async def set_admin_config(self, config: dict) -> None:
        await self._run(self._sync_set_admin_config, config)

    def _sync_set_admin_config(self, config: dict) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO admin_config (key, value) VALUES ('__global__', ?)",
            (json.dumps(config),),
        )
        conn.commit()
