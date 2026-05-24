# API Registry

Per-service setup guides. Each `.txt` file walks through obtaining the
credentials needed to enable one third-party integration: which
developer console to use, which OAuth scopes to request, where to put
the resulting keys in `.env`.

These files are intentionally **not** Markdown — they are reference
checklists you tick through during onboarding, not narrative docs.

For implementation status of each integration (live / partial /
planned) see `docs/INTEGRATIONS.md`.

---

## Index

| File | Service | Category | Live in code? | Implementation pointer |
|---|---|---|---|---|
| `alpha_vantage.txt` | Alpha Vantage | Markets | ✅ | `providers/feeds/stocks.py` |
| `amazon_seller.txt` | Amazon SP-API | Commerce / Analytics | ✅ | `providers/commerce/amazon.py`, analytics route |
| `ebay_analytics.txt` | eBay | Analytics | 🔜 planned | — |
| `etsy_analytics.txt` | Etsy | Analytics | ✅ | `api/routes/analytics.py` (5-platform list) |
| `facebook_analytics.txt` | Facebook | Analytics | ✅ | `api/routes/analytics.py` |
| `google_oauth.txt` | Google OAuth (Calendar, Gmail, Maps, Tasks, YT Music, Books) | Productivity | ✅ | `providers/google/*.py` |
| `home_assistant.txt` | Home Assistant | Smart Home | ✅ | `providers/smart_home/home_assistant.py` |
| `instagram_analytics.txt` | Instagram | Analytics | ✅ | `api/routes/analytics.py` |
| `news_api.txt` | NewsAPI.org | Feeds | ✅ | `providers/feeds/news.py` |
| `ollama_llm.txt` | Ollama | LLM (local) | ✅ | `providers/llm/ollama.py` |
| `pinterest_analytics.txt` | Pinterest | Analytics | 🔜 planned | — |
| `piper_tts.txt` | Piper TTS | TTS (local) | ✅ | `providers/tts/piper.py` |
| `shopify_analytics.txt` | Shopify | Commerce + Analytics | ✅ commerce, 🔜 analytics | `providers/commerce/shopify.py` |
| `sports_api.txt` | TheSportsDB | Feeds | ✅ | `providers/feeds/sports.py` |
| `tiktok_analytics.txt` | TikTok | Analytics | ✅ | `api/routes/analytics.py` |
| `twitter_x_analytics.txt` | Twitter / X | Analytics | 🔜 planned | — |
| `walmart_seller.txt` | Walmart Marketplace | Commerce | ⚠️ scaffold | `providers/commerce/walmart.py` |
| `weather_api.txt` | OpenWeatherMap | Feeds | ✅ | `providers/feeds/weather.py` |
| `whisper_stt.txt` | Whisper STT | STT (local) | ✅ | `providers/stt/whisper_local.py` |
| `youtube_analytics.txt` | YouTube | Analytics | 🔜 planned | — |

20 files total.

---

## How to use during onboarding

For each integration you want to enable:

1. Open the matching `.txt` file in this directory.
2. Follow the developer-console steps (create app, enable APIs, set
   redirect URIs).
3. Copy the resulting keys into `.env`. Variable names live in
   `.env.example` — find them by category.
4. Restart the backend (`sudo systemctl restart river-song` in prod,
   re-run `python main.py` in dev).
5. Toggle any associated `*_ENABLED` flag if the integration is
   gated.

**Never commit `.env`.** Only `.env.example` is tracked.

---

## When a file is missing

If you're adding a brand-new integration that isn't in the table:

1. Add the setup guide to this directory as `<service_name>.txt`.
2. Add a row to the table above.
3. Add the env vars to `.env.example`.
4. Add a row to `docs/INTEGRATIONS.md`.

---

## Freshness

These guides do not currently carry "last verified" dates. External
APIs (auth URLs, scopes, quota limits) change frequently. When you
walk a guide, if a step is wrong, update the file *and* add a
`# last verified: YYYY-MM-DD` line at the top. Treat anything
unverified for more than ~12 months with healthy suspicion.
