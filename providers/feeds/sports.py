# =============================================================================
# providers/feeds/sports.py
#
# Sports results provider for River Song AI.
# New implementation -- no usable source existed in the legacy codebase.
#
# API: TheSportsDB (https://www.thesportsdb.com/api.php)
#   Free tier (API key "1") supports:
#     - Team search by name
#     - Last 5 events for a team
#     - Next 5 scheduled events for a team
#   Paid tiers add live scores, more history, and player stats.
#
# Typical queries handled:
#   "How did the Cubs do?"           -> last game result for Chicago Cubs
#   "Did the Bears win last night?"  -> same
#   "When do the Bulls play next?"   -> next scheduled game
#   "What's the score for the Heat?" -> last known result
#
# Team name resolution:
#   Maps common aliases and nicknames to full team names the API recognizes.
#   "Cubs" -> "Chicago Cubs", "Pats" -> "New England Patriots", etc.
# =============================================================================

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx


logger = logging.getLogger(__name__)

_BASE_URL = "https://www.thesportsdb.com/api/v1/json"

# Common team nickname / alias -> full team name for API lookup.
_TEAM_ALIASES: Dict[str, str] = {
    # MLB
    "cubs": "Chicago Cubs",
    "sox": "Chicago White Sox",
    "white sox": "Chicago White Sox",
    "red sox": "Boston Red Sox",
    "yankees": "New York Yankees",
    "mets": "New York Mets",
    "dodgers": "Los Angeles Dodgers",
    "giants": "San Francisco Giants",
    "braves": "Atlanta Braves",
    "cardinals": "St. Louis Cardinals",
    "brewers": "Milwaukee Brewers",
    "reds": "Cincinnati Reds",
    "pirates": "Pittsburgh Pirates",
    "phillies": "Philadelphia Phillies",
    "nationals": "Washington Nationals",
    "marlins": "Miami Marlins",
    "astros": "Houston Astros",
    "rangers": "Texas Rangers",
    "athletics": "Oakland Athletics",
    "a's": "Oakland Athletics",
    "angels": "Los Angeles Angels",
    "mariners": "Seattle Mariners",
    "twins": "Minnesota Twins",
    "royals": "Kansas City Royals",
    "tigers": "Detroit Tigers",
    "indians": "Cleveland Guardians",
    "guardians": "Cleveland Guardians",
    "orioles": "Baltimore Orioles",
    "rays": "Tampa Bay Rays",
    "blue jays": "Toronto Blue Jays",
    "padres": "San Diego Padres",
    "rockies": "Colorado Rockies",
    "diamondbacks": "Arizona Diamondbacks",
    "d-backs": "Arizona Diamondbacks",
    # NFL
    "bears": "Chicago Bears",
    "packers": "Green Bay Packers",
    "vikings": "Minnesota Vikings",
    "lions": "Detroit Lions",
    "cowboys": "Dallas Cowboys",
    "eagles": "Philadelphia Eagles",
    "giants nfl": "New York Giants",
    "redskins": "Washington Commanders",
    "commanders": "Washington Commanders",
    "patriots": "New England Patriots",
    "pats": "New England Patriots",
    "jets": "New York Jets",
    "bills": "Buffalo Bills",
    "dolphins": "Miami Dolphins",
    "ravens": "Baltimore Ravens",
    "steelers": "Pittsburgh Steelers",
    "browns": "Cleveland Browns",
    "bengals": "Cincinnati Bengals",
    "colts": "Indianapolis Colts",
    "texans": "Houston Texans",
    "jaguars": "Jacksonville Jaguars",
    "titans": "Tennessee Titans",
    "broncos": "Denver Broncos",
    "chiefs": "Kansas City Chiefs",
    "raiders": "Las Vegas Raiders",
    "chargers": "Los Angeles Chargers",
    "49ers": "San Francisco 49ers",
    "seahawks": "Seattle Seahawks",
    "rams": "Los Angeles Rams",
    "cardinals nfl": "Arizona Cardinals",
    "saints": "New Orleans Saints",
    "falcons": "Atlanta Falcons",
    "panthers": "Carolina Panthers",
    "buccaneers": "Tampa Bay Buccaneers",
    "bucs": "Tampa Bay Buccaneers",
    # NBA
    "bulls": "Chicago Bulls",
    "heat": "Miami Heat",
    "lakers": "Los Angeles Lakers",
    "celtics": "Boston Celtics",
    "warriors": "Golden State Warriors",
    "nets": "Brooklyn Nets",
    "knicks": "New York Knicks",
    "sixers": "Philadelphia 76ers",
    "76ers": "Philadelphia 76ers",
    "raptors": "Toronto Raptors",
    "bucks": "Milwaukee Bucks",
    "hawks": "Atlanta Hawks",
    "hornets": "Charlotte Hornets",
    "pistons": "Detroit Pistons",
    "pacers": "Indiana Pacers",
    "cavaliers": "Cleveland Cavaliers",
    "cavs": "Cleveland Cavaliers",
    "magic": "Orlando Magic",
    "wizards": "Washington Wizards",
    "suns": "Phoenix Suns",
    "nuggets": "Denver Nuggets",
    "thunder": "Oklahoma City Thunder",
    "jazz": "Utah Jazz",
    "trailblazers": "Portland Trail Blazers",
    "blazers": "Portland Trail Blazers",
    "timberwolves": "Minnesota Timberwolves",
    "wolves": "Minnesota Timberwolves",
    "pelicans": "New Orleans Pelicans",
    "grizzlies": "Memphis Grizzlies",
    "spurs": "San Antonio Spurs",
    "rockets": "Houston Rockets",
    "mavericks": "Dallas Mavericks",
    "mavs": "Dallas Mavericks",
    "clippers": "Los Angeles Clippers",
    "kings": "Sacramento Kings",
}


class SportsProvider:
    """
    Async sports results provider using TheSportsDB API.

    Args:
        api_key: TheSportsDB API key. Use "1" for the free tier.
    """

    def __init__(self, api_key: str = "1") -> None:
        self._api_key = api_key or "1"

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    async def search_team(self, team_name: str) -> Optional[Dict[str, Any]]:
        """
        Search for a team by name and return its TheSportsDB team record.

        Args:
            team_name: Full or partial team name (e.g., "Chicago Cubs").

        Returns:
            Team dict with keys: id, name, sport, league, country, badge_url.
            None if no team was found.
        """
        params = {"t": team_name}
        data = await self._get("searchteams.php", params)
        teams = data.get("teams") or []
        if not teams:
            logger.warning("No team found for '%s'.", team_name)
            return None
        team = teams[0]
        return {
            "id": team.get("idTeam"),
            "name": team.get("strTeam"),
            "sport": team.get("strSport"),
            "league": team.get("strLeague"),
            "country": team.get("strCountry"),
            "badge_url": team.get("strTeamBadge"),
        }

    async def get_last_results(
        self, team_id: str, max_results: int = 3
    ) -> List[Dict[str, Any]]:
        """
        Fetch the most recent completed events for a team.

        Args:
            team_id: TheSportsDB internal team ID (from search_team()).
            max_results: Maximum number of results to return.

        Returns:
            List of event dicts, most recent first. Each dict contains:
            date, home_team, away_team, home_score, away_score, league,
            result_label ("Win", "Loss", or "Draw" relative to team_id).
        """
        data = await self._get("eventslast.php", {"id": team_id})
        events = data.get("results") or []
        parsed = [self._parse_event(e) for e in events]
        return parsed[:max_results]

    async def get_next_events(
        self, team_id: str, max_results: int = 3
    ) -> List[Dict[str, Any]]:
        """
        Fetch upcoming scheduled events for a team.

        Args:
            team_id: TheSportsDB internal team ID.
            max_results: Maximum number of upcoming events to return.

        Returns:
            List of event dicts (home_score / away_score will be None for
            future events).
        """
        data = await self._get("eventsnext.php", {"id": team_id})
        events = data.get("events") or []
        parsed = [self._parse_event(e) for e in events]
        return parsed[:max_results]

    async def get_team_results(self, team_name: str) -> Dict[str, Any]:
        """
        High-level helper: search for a team and return its most recent result.

        Combines search_team() + get_last_results() into a single call.

        Args:
            team_name: Team name as spoken by the user (after alias resolution).

        Returns:
            Dict with keys: team (dict), last_events (list), next_events (list).
            team is None if the team was not found.
        """
        team = await self.search_team(team_name)
        if not team or not team.get("id"):
            return {"team": None, "last_events": [], "next_events": []}

        team_id = team["id"]
        last_events = await self.get_last_results(team_id)
        next_events = await self.get_next_events(team_id, max_results=1)
        return {
            "team": team,
            "last_events": last_events,
            "next_events": next_events,
        }

    # -------------------------------------------------------------------------
    # TTS formatters
    # -------------------------------------------------------------------------

    @staticmethod
    def format_results_for_speech(data: Dict[str, Any], requested_name: str) -> str:
        """
        Convert get_team_results() output to a TTS-friendly string.

        Args:
            data: Dict returned by get_team_results().
            requested_name: The team name as the user said it.

        Returns:
            Plain-text sports summary suitable for speaking aloud.
        """
        team = data.get("team")
        if not team:
            return (
                f"I could not find a team called '{requested_name}' in the database. "
                "Try using the full team name, like 'Chicago Cubs'."
            )

        team_name = team.get("name", requested_name)
        last_events = data.get("last_events", [])
        next_events = data.get("next_events", [])

        if not last_events:
            # No recent results -- tell them about the next game instead.
            if next_events:
                nxt = next_events[0]
                return (
                    f"The {team_name} have no recent results. "
                    + _format_upcoming_event(nxt)
                )
            return f"I could not find any recent results for the {team_name}."

        # Most recent game.
        latest = last_events[0]
        lines = [_format_result_event(latest, team_name)]

        # Mention the next game if available.
        if next_events:
            lines.append(_format_upcoming_event(next_events[0]))

        return " ".join(lines)

    # -------------------------------------------------------------------------
    # Response parser
    # -------------------------------------------------------------------------

    @staticmethod
    def _parse_event(event: Dict[str, Any]) -> Dict[str, Any]:
        """Extract normalized fields from a TheSportsDB event record."""
        home = event.get("strHomeTeam", "")
        away = event.get("strAwayTeam", "")
        home_score_raw = event.get("intHomeScore")
        away_score_raw = event.get("intAwayScore")

        home_score = int(home_score_raw) if home_score_raw is not None and str(home_score_raw).isdigit() else None
        away_score = int(away_score_raw) if away_score_raw is not None and str(away_score_raw).isdigit() else None

        return {
            "id": event.get("idEvent"),
            "date": event.get("dateEvent", ""),
            "home_team": home,
            "away_team": away,
            "home_score": home_score,
            "away_score": away_score,
            "league": event.get("strLeague", ""),
            "season": event.get("strSeason", ""),
            "venue": event.get("strVenue", ""),
            "status": event.get("strStatus", ""),
        }

    # -------------------------------------------------------------------------
    # HTTP helper
    # -------------------------------------------------------------------------

    async def _get(self, endpoint: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Send an async GET to TheSportsDB and return the JSON body."""
        url = f"{_BASE_URL}/{self._api_key}/{endpoint}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()


# -------------------------------------------------------------------------
# Internal formatting helpers
# -------------------------------------------------------------------------

def _format_result_event(event: Dict[str, Any], team_name: str) -> str:
    """Format a completed game result into a spoken sentence."""
    home = event.get("home_team", "the home team")
    away = event.get("away_team", "the away team")
    home_score = event.get("home_score")
    away_score = event.get("away_score")
    date_str = event.get("date", "")
    date_label = _friendly_sports_date(date_str)

    if home_score is None or away_score is None:
        return f"The {team_name} played {date_label} but the score was not available."

    if home == team_name or team_name.lower() in home.lower():
        team_score, opp_score, opponent = home_score, away_score, away
        side = "at home"
    else:
        team_score, opp_score, opponent = away_score, home_score, home
        side = "away"

    if team_score > opp_score:
        result = "won"
    elif team_score < opp_score:
        result = "lost"
    else:
        result = "tied"

    return (
        f"The {team_name} {result} {date_label} {side} against {opponent}, "
        f"{team_score} to {opp_score}."
    )


def _format_upcoming_event(event: Dict[str, Any]) -> str:
    """Format an upcoming scheduled event into a spoken sentence."""
    home = event.get("home_team", "")
    away = event.get("away_team", "")
    date_str = event.get("date", "")
    date_label = _friendly_sports_date(date_str)

    if home and away:
        return f"Their next game is {date_label} against {''.join([t for t in [home, away] if t])}."
    return f"Their next scheduled game is {date_label}."


def _friendly_sports_date(date_str: str) -> str:
    """Convert a date string 'YYYY-MM-DD' to 'last Tuesday' or 'on April 18th'."""
    try:
        dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
        now = datetime.now()
        delta = (now.date() - dt.date()).days
        if delta == 0:
            return "today"
        if delta == 1:
            return "yesterday"
        if 1 < delta <= 7:
            return f"last {dt.strftime('%A')}"
        return f"on {dt.strftime('%B %-d')}"
    except (ValueError, TypeError):
        return "recently"


# -------------------------------------------------------------------------
# Team name extraction helpers
# -------------------------------------------------------------------------

def resolve_team_name(query: str) -> Optional[str]:
    """
    Resolve a spoken team reference to the full team name for API search.

    Checks the alias map first, then falls back to the raw query.

    Args:
        query: Lowercased team name fragment from the transcript.

    Returns:
        Full team name string (e.g., "Chicago Cubs"), or None if not resolved.
    """
    lower = query.lower().strip()
    for alias, full_name in _TEAM_ALIASES.items():
        if alias in lower:
            return full_name
    # Capitalize the raw query and use it directly.
    if lower:
        return query.strip().title()
    return None


def extract_team_from_transcript(transcript: str) -> Optional[str]:
    """
    Extract a team name from a sports query transcript.

    Strips common sports preamble phrases and resolves the remainder
    against the team alias map.

    Args:
        transcript: Raw transcript string.

    Returns:
        Resolved full team name, or None if not found.
    """
    lower = transcript.lower()
    stripped = re.sub(
        r"how\s+did\s+the\s+|did\s+the\s+|how\s+are\s+the\s+|"
        r"what(?:'s|\s+is|\s+was)\s+the\s+score\s+(?:for\s+)?(?:the\s+)?|"
        r"when\s+(?:do|does|are|is)\s+the\s+|"
        r"\bwin\b|\blose\b|\bdo\b|\bdoing\b|\bplay\b|\bgame\b|"
        r"\blast\s+night\b|\byesterday\b|\btoday\b|\blast\s+\w+\b",
        " ",
        lower,
    )
    stripped = " ".join(stripped.split())
    return resolve_team_name(stripped)


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------

def build_sports_provider() -> SportsProvider:
    """
    Convenience factory that builds a SportsProvider using app settings.

    Returns:
        Configured SportsProvider instance.
    """
    from config.settings import get_settings
    s = get_settings()
    return SportsProvider(api_key=s.sports_api_key)
