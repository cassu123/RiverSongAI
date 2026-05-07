"""
providers/feeds/sports.py

Sports provider using ESPN's public API.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

ESPN_LEAGUES = {
    "nfl":        {"sport": "football",    "league": "nfl",                      "label": "NFL",              "icon": "🏈", "category": "American Pro"},
    "nba":        {"sport": "basketball",  "league": "nba",                      "label": "NBA",              "icon": "🏀", "category": "American Pro"},
    "mlb":        {"sport": "baseball",    "league": "mlb",                      "label": "MLB",              "icon": "⚾", "category": "American Pro"},
    "nhl":        {"sport": "hockey",      "league": "nhl",                      "label": "NHL",              "icon": "🏒", "category": "American Pro"},
    "mls":        {"sport": "soccer",      "league": "usa.1",                    "label": "MLS",              "icon": "⚽", "category": "American Pro"},
    "wnba":       {"sport": "basketball",  "league": "wnba",                     "label": "WNBA",             "icon": "🏀", "category": "American Pro"},
    "nwsl":       {"sport": "soccer",      "league": "usa.nwsl",                 "label": "NWSL",             "icon": "⚽", "category": "American Pro"},
    "ncaaf":      {"sport": "football",    "league": "college-football",         "label": "NCAAF",            "icon": "🏈", "category": "College"},
    "ncaab":      {"sport": "basketball",  "league": "mens-college-basketball",  "label": "NCAAB",            "icon": "🏀", "category": "College"},
    "ncaabw":     {"sport": "basketball",  "league": "womens-college-basketball","label": "NCAAB Women",      "icon": "🏀", "category": "College"},
    "epl":        {"sport": "soccer",      "league": "eng.1",                    "label": "Premier League",   "icon": "⚽", "category": "Global Soccer"},
    "laliga":     {"sport": "soccer",      "league": "esp.1",                    "label": "La Liga",          "icon": "⚽", "category": "Global Soccer"},
    "seriea":     {"sport": "soccer",      "league": "ita.1",                    "label": "Serie A",          "icon": "⚽", "category": "Global Soccer"},
    "bundesliga": {"sport": "soccer",      "league": "ger.1",                    "label": "Bundesliga",       "icon": "⚽", "category": "Global Soccer"},
    "ligue1":     {"sport": "soccer",      "league": "fra.1",                    "label": "Ligue 1",          "icon": "⚽", "category": "Global Soccer"},
    "ucl":        {"sport": "soccer",      "league": "uefa.champions",           "label": "Champions League", "icon": "⚽", "category": "Global Soccer"},
    "uel":        {"sport": "soccer",      "league": "uefa.europa",              "label": "Europa League",    "icon": "⚽", "category": "Global Soccer"},
    "ligamx":     {"sport": "soccer",      "league": "mex.1",                    "label": "Liga MX",          "icon": "⚽", "category": "Global Soccer"},
    "atp":        {"sport": "tennis",      "league": "atp",                      "label": "ATP Tennis",       "icon": "🎾", "category": "Racket"},
    "wta":        {"sport": "tennis",      "league": "wta",                      "label": "WTA Tennis",       "icon": "🎾", "category": "Racket"},
    "pga":        {"sport": "golf",        "league": "pga",                      "label": "PGA Tour",         "icon": "⛳", "category": "Golf"},
    "lpga":       {"sport": "golf",        "league": "lpga",                     "label": "LPGA",             "icon": "⛳", "category": "Golf"},
    "f1":         {"sport": "racing",      "league": "f1",                       "label": "Formula 1",        "icon": "🏎️ ", "category": "Racing",    "stub": True},
    "nascar":     {"sport": "racing",      "league": "nascar",                   "label": "NASCAR",           "icon": "🏎️ ", "category": "Racing",    "stub": True},
    "ufc":        {"sport": "mma",         "league": "ufc",                      "label": "UFC/MMA",          "icon": "🥊", "category": "Combat",    "stub": True},
    "boxing":     {"sport": "boxing",      "league": "boxing",                   "label": "Boxing",           "icon": "🥊", "category": "Combat",    "stub": True},
    "rugby":      {"sport": "rugby",       "league": "rugby",                    "label": "Rugby Union",      "icon": "🏉", "category": "Global",    "stub": True},
    "cricket":    {"sport": "cricket",     "league": "cricket",                  "label": "Cricket",          "icon": "🏏", "category": "Global",    "stub": True},
    "afl":        {"sport": "afl",         "league": "afl",                      "label": "AFL",              "icon": "🏉", "category": "Global",    "stub": True},
    "esports":    {"sport": "esports",     "league": "esports",                  "label": "Esports",          "icon": "🎮", "category": "Esports",   "stub": True},
}

BASE_URL = "https://site.api.espn.com/apis/site/v2/sports"

_cache: dict = {}

def _get_from_cache(key: str) -> Optional[Any]:
    if key in _cache:
        val, expiry = _cache[key]
        if time.time() < expiry:
            return val
    return None

def _set_cache(key: str, val: Any, ttl_sec: int):
    _cache[key] = (val, time.time() + ttl_sec)

async def get_leagues() -> list[dict]:
    return [{"id": k, **v} for k, v in ESPN_LEAGUES.items()]

async def get_teams(league_id: str) -> list[dict]:
    cached = _get_from_cache(f"teams:{league_id}")
    if cached: return cached

    info = ESPN_LEAGUES.get(league_id)
    if not info or info.get("stub"):
        return []

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = f"{BASE_URL}/{info['sport']}/{info['league']}/teams?limit=200"
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            teams_data = data["sports"][0]["leagues"][0]["teams"]
            
            results = []
            for t in teams_data:
                team = t["team"]
                results.append({
                    "id": team["id"],
                    "name": team["displayName"],
                    "abbr": team["abbreviation"],
                    "logo": team["logos"][0]["href"] if team.get("logos") else "",
                    "color": team.get("color", ""),
                    "league_id": league_id,
                    "league_label": info["label"],
                    "sport": info["sport"],
                    "icon": info["icon"],
                })
            
            _set_cache(f"teams:{league_id}", results, 86400) # 24h
            return results
    except Exception as exc:
        logger.warning("ESPN get_teams failed for %s: %s", league_id, exc)
        return []

async def get_scoreboard(league_id: str) -> list[dict]:
    cached = _get_from_cache(f"scoreboard:{league_id}")
    if cached: return cached

    info = ESPN_LEAGUES.get(league_id)
    if not info: return []

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = f"{BASE_URL}/{info['sport']}/{info['league']}/scoreboard"
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            
            results = []
            for event in data.get("events", []):
                competition = event["competitions"][0]
                results.append({
                    "id": event["id"],
                    "name": event["name"],
                    "short_name": event["shortName"],
                    "date": event["date"],
                    "status": event["status"]["type"]["name"],
                    "status_detail": event["status"]["type"]["shortDetail"],
                    "is_live": event["status"]["type"]["state"] == "in",
                    "home_team": competition["competitors"][0]["team"]["displayName"],
                    "home_abbr": competition["competitors"][0]["team"]["abbreviation"],
                    "home_logo": competition["competitors"][0]["team"]["logo"] if "logo" in competition["competitors"][0]["team"] else "",
                    "home_score": competition["competitors"][0].get("score", ""),
                    "home_winner": competition["competitors"][0].get("winner", False),
                    "away_team": competition["competitors"][1]["team"]["displayName"],
                    "away_abbr": competition["competitors"][1]["team"]["abbreviation"],
                    "away_logo": competition["competitors"][1]["team"]["logo"] if "logo" in competition["competitors"][1]["team"] else "",
                    "away_score": competition["competitors"][1].get("score", ""),
                    "away_winner": competition["competitors"][1].get("winner", False),
                    "venue": competition["venue"]["fullName"] if competition.get("venue") else "",
                    "league_id": league_id,
                })
            
            _set_cache(f"scoreboard:{league_id}", results, 60) # 60s
            return results
    except Exception as exc:
        logger.warning("ESPN get_scoreboard failed for %s: %s", league_id, exc)
        return []

async def get_standings(league_id: str) -> list[dict]:
    cached = _get_from_cache(f"standings:{league_id}")
    if cached: return cached

    info = ESPN_LEAGUES.get(league_id)
    if not info: return []

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = f"{BASE_URL}/{info['sport']}/{info['league']}/standings"
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            
            entries = data["standings"]["entries"]
            results = []
            for entry in entries:
                team = entry["team"]
                results.append({
                    "team_id": team["id"],
                    "team": team["displayName"],
                    "abbr": team["abbreviation"],
                    "logo": team["logos"][0]["href"] if team.get("logos") else "",
                    "stats": {s["name"]: s["displayValue"] for s in entry.get("stats", [])},
                })
            
            _set_cache(f"standings:{league_id}", results, 3600) # 1h
            return results
    except Exception as exc:
        logger.warning("ESPN get_standings failed for %s: %s", league_id, exc)
        return []

async def get_schedule(team_id: str, league_id: str) -> list[dict]:
    cached = _get_from_cache(f"schedule:{league_id}:{team_id}")
    if cached: return cached

    info = ESPN_LEAGUES.get(league_id)
    if not info: return []

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = f"{BASE_URL}/{info['sport']}/{info['league']}/teams/{team_id}/schedule"
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            
            events = data.get("events", [])
            results = []
            for event in events:
                comp = event["competitions"][0]
                # Filter pre-game events only (state != post)
                if comp["status"]["type"]["state"] == "post":
                    continue
                
                results.append({
                    "id": event["id"],
                    "name": event["name"],
                    "short_name": event["shortName"],
                    "date": event["date"],
                    "status": event["status"]["type"]["name"],
                    "status_detail": event["status"]["type"]["shortDetail"],
                    "is_live": event["status"]["type"]["state"] == "in",
                    "home_team": comp["competitors"][0]["team"]["displayName"],
                    "home_abbr": comp["competitors"][0]["team"]["abbreviation"],
                    "home_logo": comp["competitors"][0]["team"]["logo"] if "logo" in comp["competitors"][0]["team"] else "",
                    "home_score": comp["competitors"][0].get("score", ""),
                    "home_winner": comp["competitors"][0].get("winner", False),
                    "away_team": comp["competitors"][1]["team"]["displayName"],
                    "away_abbr": comp["competitors"][1]["team"]["abbreviation"],
                    "away_logo": comp["competitors"][1]["team"]["logo"] if "logo" in comp["competitors"][1]["team"] else "",
                    "away_score": comp["competitors"][1].get("score", ""),
                    "away_winner": comp["competitors"][1].get("winner", False),
                    "venue": comp["venue"]["fullName"] if comp.get("venue") else "",
                    "league_id": league_id,
                })
                if len(results) >= 10:
                    break
            
            _set_cache(f"schedule:{league_id}:{team_id}", results, 3600) # 1h
            return results
    except Exception as exc:
        logger.warning("ESPN get_schedule failed for %s/%s: %s", league_id, team_id, exc)
        return []

async def get_boxscore(event_id: str, league_id: str) -> dict:
    cached = _get_from_cache(f"boxscore:{event_id}")
    if cached: return cached

    info = ESPN_LEAGUES.get(league_id)
    if not info: return {}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = f"{BASE_URL}/{info['sport']}/{info['league']}/summary?event={event_id}"
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            
            res = {
                "header": data.get("header", {}),
                "boxscore": data.get("boxscore", {}),
                "plays": data.get("plays", []),
                "league_id": league_id
            }
            
            _set_cache(f"boxscore:{event_id}", res, 30) # 30s
            return res
    except Exception as exc:
        logger.warning("ESPN get_boxscore failed for %s: %s", event_id, exc)
        return {}

# LEGACY — TheSportsDB
# def _get_base() -> str:
#     key = get_settings().sports_api_key or "3"
#     if key == "1": key = "3"
#     return f"https://www.thesportsdb.com/api/v1/json/{key}"
#
# SUPPORTED_SPORTS = [
#     {"id": "4328", "name": "Premier League", "sport": "Soccer", "country": "England"},
#     {"id": "4335", "name": "La Liga", "sport": "Soccer", "country": "Spain"},
#     {"id": "4331", "name": "Bundesliga", "sport": "Soccer", "country": "Germany"},
#     {"id": "4332", "name": "Serie A", "sport": "Soccer", "country": "Italy"},
#     {"id": "4334", "name": "Ligue 1", "sport": "Soccer", "country": "France"},
#     {"id": "4387", "name": "NFL", "sport": "American Football", "country": "USA"},
#     {"id": "4391", "name": "NBA", "sport": "Basketball", "country": "USA"},
#     {"id": "4424", "name": "MLB", "sport": "Baseball", "country": "USA"},
#     {"id": "4380", "name": "NHL", "sport": "Ice Hockey", "country": "USA/Canada"},
#     {"id": "4346", "name": "Formula 1", "sport": "Motorsport", "country": "World"},
#     {"id": "4430", "name": "MLS", "sport": "Soccer", "country": "USA"},
#     {"id": "4480", "name": "Champions League", "sport": "Soccer", "country": "Europe"},
#     {"id": "4443", "name": "Australian Football (AFL)", "sport": "Australian Rules", "country": "Australia"},
#     {"id": "4484", "name": "Rugby World Cup", "sport": "Rugby Union", "country": "World"},
#     {"id": "4367", "name": "Premiership Rugby", "sport": "Rugby Union", "country": "England"},
#     {"id": "4351", "name": "Cricket - IPL", "sport": "Cricket", "country": "India"},
#     {"id": "4361", "name": "Cricket - The Ashes", "sport": "Cricket", "country": "England/Australia"},
# ]
#
# async def search_teams(query: str) -> List[Dict[str, Any]]:
#     try:
#         async with httpx.AsyncClient(timeout=10) as client:
#             resp = await client.get(f"{_get_base()}/searchteams.php", params={"t": query})
#             resp.raise_for_status()
#             data = resp.json()
#     except Exception as exc:
#         logger.warning("TheSportsDB team search failed: %s", exc)
#         return []
#     teams = data.get("teams") or []
#     return [_format_team(t) for t in teams[:10]]
#
# async def fetch_team_results(team_id: str) -> List[Dict[str, Any]]:
#     try:
#         async with httpx.AsyncClient(timeout=10) as client:
#             resp = await client.get(f"{_get_base()}/eventslast.php", params={"id": team_id})
#             resp.raise_for_status()
#             data = resp.json()
#     except Exception as exc:
#         logger.warning("TheSportsDB last events failed for team %s: %s", team_id, exc)
#         return []
#     events = data.get("results") or []
#     return [_format_event(e) for e in events]
#
# async def fetch_team_fixtures(team_id: str) -> List[Dict[str, Any]]:
#     try:
#         async with httpx.AsyncClient(timeout=10) as client:
#             resp = await client.get(f"{_get_base()}/eventsnext.php", params={"id": team_id})
#             resp.raise_for_status()
#             data = resp.json()
#     except Exception as exc:
#         logger.warning("TheSportsDB next events failed for team %s: %s", team_id, exc)
#         return []
#     events = data.get("events") or []
#     return [_format_event(e) for e in events]
#
# async def fetch_teams_feed(team_ids: List[str]) -> Dict[str, Any]:
#     import asyncio
#     if not team_ids: return {"results": [], "fixtures": []}
#     result_tasks = [fetch_team_results(tid) for tid in team_ids]
#     fixture_tasks = [fetch_team_fixtures(tid) for tid in team_ids]
#     all_results, all_fixtures = await asyncio.gather(
#         asyncio.gather(*result_tasks),
#         asyncio.gather(*fixture_tasks),
#     )
#     results = [e for group in all_results for e in group]
#     fixtures = [e for group in all_fixtures for e in group]
#     results.sort(key=lambda e: e.get("date") or "", reverse=True)
#     fixtures.sort(key=lambda e: e.get("date") or "")
#     return {"results": results[:20], "fixtures": fixtures[:20]}
#
# async def fetch_standings(league_id: str, season: str = "") -> List[Dict[str, Any]]:
#     params: Dict[str, str] = {"l": league_id}
#     if season: params["s"] = season
#     try:
#         async with httpx.AsyncClient(timeout=10) as client:
#             resp = await client.get(f"{_get_base()}/lookuptable.php", params=params)
#             resp.raise_for_status()
#             data = resp.json()
#     except Exception as exc:
#         logger.warning("TheSportsDB standings failed for league %s: %s", league_id, exc)
#         return []
#     rows = data.get("table") or []
#     return [_format_standing(r) for r in rows]
#
# async def fetch_event_stats(event_id: str) -> List[Dict[str, Any]]:
#     try:
#         async with httpx.AsyncClient(timeout=10) as client:
#             resp = await client.get(f"{_get_base()}/lookupeventstats.php", params={"id": event_id})
#             resp.raise_for_status()
#             data = resp.json()
#     except Exception as exc:
#         logger.warning("TheSportsDB event stats failed for event %s: %s", event_id, exc)
#         return []
#     stats = data.get("eventstats") or []
#     return [_format_stat(s) for s in stats]
#
# def _format_team(t: Dict) -> Dict[str, Any]:
#     return {
#         "id": t.get("idTeam") or "",
#         "name": t.get("strTeam") or "",
#         "sport": t.get("strSport") or "",
#         "league": t.get("strLeague") or "",
#         "league_id": t.get("idLeague") or "",
#         "country": t.get("strCountry") or "",
#         "badge_url": t.get("strBadge") or t.get("strTeamBadge") or "",
#         "stadium": t.get("strStadium") or "",
#         "colour1": t.get("strColour1") or "",
#         "colour2": t.get("strColour2") or "",
#     }
#
# def _format_standing(r: Dict) -> Dict[str, Any]:
#     return {
#         "rank": int(r.get("intRank") or 0),
#         "team_id": r.get("idTeam") or "",
#         "team": r.get("strTeam") or "",
#         "badge_url": r.get("strBadge") or "",
#         "league_id": r.get("idLeague") or "",
#         "league": r.get("strLeague") or "",
#         "season": r.get("strSeason") or "",
#         "form": r.get("strForm") or "",
#         "description": r.get("strDescription") or "",
#         "played": int(r.get("intPlayed") or 0),
#         "win": int(r.get("intWin") or 0),
#         "draw": int(r.get("intDraw") or 0),
#         "loss": int(r.get("intLoss") or 0),
#         "goals_for": int(r.get("intGoalsFor") or 0),
#         "goals_against": int(r.get("intGoalsAgainst") or 0),
#         "goal_diff": int(r.get("intGoalDifference") or 0),
#         "points": int(r.get("intPoints") or 0),
#     }
#
# def _format_event(e: Dict) -> Dict[str, Any]:
#     home = e.get("strHomeTeam") or ""; away = e.get("strAwayTeam") or ""
#     home_score = e.get("intHomeScore"); away_score = e.get("intAwayScore")
#     finished = home_score is not None and away_score is not None
#     return {
#         "id": e.get("idEvent") or "",
#         "date": e.get("dateEvent") or "",
#         "time": e.get("strTime") or "",
#         "home_team": home, "away_team": away,
#         "home_score": home_score, "away_score": away_score,
#         "league": e.get("strLeague") or "", "sport": e.get("strSport") or "",
#         "venue": e.get("strVenue") or "", "finished": finished,
#         "result": f"{home} {home_score}–{away_score} {away}" if finished else f"{home} vs {away}",
#         "home_badge": e.get("strHomeTeamBadge") or "", "away_badge": e.get("strAwayTeamBadge") or "",
#     }
#
# def _format_stat(s: Dict) -> Dict[str, Any]:
#     return {
#         "label": s.get("strStat") or "",
#         "home": s.get("intHome") or s.get("strValueHome") or "0",
#         "away": s.get("intAway") or s.get("strValueAway") or "0",
#     }
