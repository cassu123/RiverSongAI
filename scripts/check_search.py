#!/usr/bin/env python3
"""
scripts/check_search.py — which web search actually answers

The search chain fails quietly on purpose: a provider that is down is skipped
and the next one tried, which is right for a running system and useless for
finding out why answers got worse. Nothing logs "you have no search at all"
because at every individual step something plausible happened.

That matters more than it looks. Appliance profiles are grounded in a web
search, and with no provider live they fall back to what the model remembers
about the product name -- which is how an Instant Ace Nova, a cooking blender,
turns into a pressure cooker. The profile still gets built. It is just built
from the brand rather than the machine.

So this runs the real chain against a real query and says which link answered.

    python scripts/check_search.py
    python scripts/check_search.py "Instant Ace Nova specifications"
"""

import asyncio
import sys

sys.path.insert(0, ".")

from config.settings import get_settings              # noqa: E402
from providers.web.search import (                    # noqa: E402
    BraveSearchProvider,
    GooglePSESearchProvider,
    SearXNGSearchProvider,
    TavilySearchProvider,
    TinyFishSearchProvider,
)

DEFAULT_QUERY = "Instant Ace Nova specifications manual cooking functions"


def _configured():
    """Every provider the settings ask for, in chain order."""
    s = get_settings()
    out = [("SearXNG (local)", lambda: SearXNGSearchProvider(s.searxng_base_url),
            s.searxng_base_url)]
    out.append(("Brave", lambda: BraveSearchProvider(s.brave_search_api_key),
                "key set" if s.brave_search_api_key else ""))
    out.append(("Tavily", lambda: TavilySearchProvider(s.tavily_api_key),
                "key set" if s.tavily_api_key else ""))
    out.append(("Google PSE",
                lambda: GooglePSESearchProvider(s.google_pse_api_key, s.google_pse_cx),
                "key set" if (s.google_pse_api_key and s.google_pse_cx) else ""))
    out.append(("TinyFish", lambda: TinyFishSearchProvider(s.tinyfish_api_key),
                "key set" if s.tinyfish_api_key else ""))
    return out


async def main() -> int:
    query = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_QUERY
    print(f"Query: {query}\n")

    live = 0
    for name, build, note in _configured():
        if not note:
            print(f"  {name:<16} not configured")
            continue
        try:
            provider = build()
        except Exception as exc:
            print(f"  {name:<16} not usable — {exc}")
            continue

        try:
            result = await provider.search(query, 3)
        except Exception as exc:
            print(f"  {name:<16} FAILED — {exc}")
            continue

        # The same floor build_profile applies. A provider that answers with
        # almost nothing is not a provider that answered.
        if not result or len(result.strip()) < 120:
            print(f"  {name:<16} empty answer ({len(result or '')} chars)")
            continue

        live += 1
        first = result.strip().splitlines()
        preview = next((ln.strip() for ln in first[1:] if ln.strip()), "")
        print(f"  {name:<16} OK — {len(result)} chars")
        print(f"  {'':<16} {preview[:100]}")

    print()
    if live:
        print(f"{live} provider(s) answering. Appliance profiles will be "
              f"grounded in search results.")
        return 0

    print("No search provider answered.\n\n"
          "Appliance profiles still build, from what the model remembers of "
          "the product name rather than from a page about the product. That is "
          "the case where an Instant Ace Nova becomes a pressure cooker.\n\n"
          "Cheapest fixes, in order:\n"
          "  * SearXNG, local and unlimited:  bash scripts/start_searxng.sh\n"
          "  * Brave, 2,000/month free:       BRAVE_SEARCH_API_KEY= in .env\n"
          "  * Tavily, 1,000/month free:      TAVILY_API_KEY= in .env")
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
