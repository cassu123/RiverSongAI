"""
providers/feeds/sports.py

Sports provider using TheSportsDB free API (key "3").
Supports team search, last 5 results, and next 5 fixtures.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://www.thesportsdb.com/api/v1/json/3"

# Curated sport leagues for the team-search UI picker
SUPPORTED_SPORTS = [
    {"id": "4328", "name": "Premier League", "sport": "Soccer", "country": "England"},
    {"id": "4335", "name": "La Liga", "sport": "Soccer", "country": "Spain"},
    {"id": "4331", "name": "Bundesliga", "sport": "Soccer", "country": "Germany"},
    {"id": "4332", "name": "Serie A", "sport": "Soccer", "country": "Italy"},
    {"id": "4334", "name": "Ligue 1", "sport": "Soccer", "country": "France"},
    {"id": "4387", "name": "NFL", "sport": "American Football", "country": "USA"},
    {"id": "4391", "name": "NBA", "sport": "Basketball", "country": "USA"},
    {"id": "4424", "name": "MLB", "sport": "Baseball", "country": "USA"},
    {"id": "4380", "name": "NHL", "sport": "Ice Hockey", "country": "USA/Canada"},
    {"id": "4346", "name": "Formula 1", "sport": "Motorsport", "country": "World"},
    {"id": "4430", "name": "MLS", "sport": "Soccer", "country": "USA"},
    {"id": "4480", "name": "Champions League", "sport": "Soccer", "country": "Europe"},
    {"id": "4443", "name": "Australian Football (AFL)", "sport": "Australian Rules", "country": "Australia"},
    {"id": "4484", "name": "Rugby World Cup", "sport": "Rugby Union", "country": "World"},
    {"id": "4367", "name": "Premiership Rugby", "sport": "Rugby Union", "country": "England"},
    {"id": "4351", "name": "Cricket - IPL", "sport": "Cricket", "country": "India"},
    {"id": "4361", "name": "Cricket - The Ashes", "sport": "Cricket", "country": "England/Australia"},
]


async def search_teams(query: str) -> List[Dict[str, Any]]:
    """Search for teams by name. Returns list of team dicts."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{_BASE}/searchteams.php", params={"t": query})
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("TheSportsDB team search failed: %s", exc)
        return []

    teams = data.get("teams") or []
    return [_format_team(t) for t in teams[:10]]


async def fetch_team_results(team_id: str) -> List[Dict[str, Any]]:
    """Fetch last 5 results for a team."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{_BASE}/eventslast.php", params={"id": team_id})
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("TheSportsDB last events failed for team %s: %s", team_id, exc)
        return []

    events = data.get("results") or []
    return [_format_event(e) for e in events]


async def fetch_team_fixtures(team_id: str) -> List[Dict[str, Any]]:
    """Fetch next 5 fixtures for a team."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{_BASE}/eventsnext.php", params={"id": team_id})
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("TheSportsDB next events failed for team %s: %s", team_id, exc)
        return []

    events = data.get("events") or []
    return [_format_event(e) for e in events]


async def fetch_teams_feed(team_ids: List[str]) -> Dict[str, Any]:
    """
    Fetch results + fixtures for a list of team IDs.
    Returns {"results": [...], "fixtures": [...]} merged across all teams.
    """
    import asyncio
    if not team_ids:
        return {"results": [], "fixtures": []}

    result_tasks = [fetch_team_results(tid) for tid in team_ids]
    fixture_tasks = [fetch_team_fixtures(tid) for tid in team_ids]

    all_results, all_fixtures = await asyncio.gather(
        asyncio.gather(*result_tasks),
        asyncio.gather(*fixture_tasks),
    )

    results = [e for group in all_results for e in group]
    fixtures = [e for group in all_fixtures for e in group]

    results.sort(key=lambda e: e.get("date") or "", reverse=True)
    fixtures.sort(key=lambda e: e.get("date") or "")

    return {"results": results[:20], "fixtures": fixtures[:20]}


async def fetch_standings(league_id: str, season: str = "") -> List[Dict[str, Any]]:
    """Fetch league standings table. Season format: '2024-2025'. Empty = current."""
    params: Dict[str, str] = {"l": league_id}
    if season:
        params["s"] = season
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{_BASE}/lookuptable.php", params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("TheSportsDB standings failed for league %s: %s", league_id, exc)
        return []

    rows = data.get("table") or []
    return [_format_standing(r) for r in rows]


async def fetch_event_stats(event_id: str) -> List[Dict[str, Any]]:
    """Fetch detailed statistics for a specific event (game)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{_BASE}/lookupeventstats.php", params={"id": event_id})
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("TheSportsDB event stats failed for event %s: %s", event_id, exc)
        return []

    stats = data.get("eventstats") or []
    return [_format_stat(s) for s in stats]


def _format_team(t: Dict) -> Dict[str, Any]:
    return {
        "id": t.get("idTeam") or "",
        "name": t.get("strTeam") or "",
        "sport": t.get("strSport") or "",
        "league": t.get("strLeague") or "",
        "league_id": t.get("idLeague") or "",
        "country": t.get("strCountry") or "",
        "badge_url": t.get("strBadge") or t.get("strTeamBadge") or "",
        "stadium": t.get("strStadium") or "",
        "colour1": t.get("strColour1") or "",
        "colour2": t.get("strColour2") or "",
    }


def _format_standing(r: Dict) -> Dict[str, Any]:
    return {
        "rank": int(r.get("intRank") or 0),
        "team_id": r.get("idTeam") or "",
        "team": r.get("strTeam") or "",
        "badge_url": r.get("strBadge") or "",
        "league_id": r.get("idLeague") or "",
        "league": r.get("strLeague") or "",
        "season": r.get("strSeason") or "",
        "form": r.get("strForm") or "",
        "description": r.get("strDescription") or "",
        "played": int(r.get("intPlayed") or 0),
        "win": int(r.get("intWin") or 0),
        "draw": int(r.get("intDraw") or 0),
        "loss": int(r.get("intLoss") or 0),
        "goals_for": int(r.get("intGoalsFor") or 0),
        "goals_against": int(r.get("intGoalsAgainst") or 0),
        "goal_diff": int(r.get("intGoalDifference") or 0),
        "points": int(r.get("intPoints") or 0),
    }


def _format_event(e: Dict) -> Dict[str, Any]:
    home = e.get("strHomeTeam") or ""
    away = e.get("strAwayTeam") or ""
    home_score = e.get("intHomeScore")
    away_score = e.get("intAwayScore")
    finished = home_score is not None and away_score is not None

    return {
        "id": e.get("idEvent") or "",
        "date": e.get("dateEvent") or "",
        "time": e.get("strTime") or "",
        "home_team": home,
        "away_team": away,
        "home_score": home_score,
        "away_score": away_score,
        "league": e.get("strLeague") or "",
        "sport": e.get("strSport") or "",
        "venue": e.get("strVenue") or "",
        "finished": finished,
        "result": f"{home} {home_score}–{away_score} {away}" if finished else f"{home} vs {away}",
        "home_badge": e.get("strHomeTeamBadge") or "",
        "away_badge": e.get("strAwayTeamBadge") or "",
    }


def _format_stat(s: Dict) -> Dict[str, Any]:
    return {
        "label": s.get("strStat") or "",
        "home": s.get("strValueHome") or "0",
        "away": s.get("strValueAway") or "0",
    }
