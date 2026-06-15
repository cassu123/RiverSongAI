> **PARTIALLY IMPLEMENTED — 2026-05-23**
> Analytics AI summaries are live for 5 platforms: TikTok, Instagram, Amazon, Etsy, Facebook.
> The remaining platforms listed below (YouTube, eBay, Shopify, Pinterest, Twitter/X) have
> `docs/api_registry/*.txt` setup guides but no analytics implementation in code yet.
> See `docs/audits/DOCS_AUDIT_REPORT.md` issue H-6 and `docs/INTEGRATIONS.md` for current status per integration.

---

# River Song AI — Roadmap

## Analytics Platforms
The Analytics page currently supports manual snapshot entry for tracking growth and performance. Automated platform integrations are planned but not yet implemented.

Planned integrations:
- **TikTok:** Automated metric collection using `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, and `TIKTOK_ACCESS_TOKEN`.
- **Instagram:** Engagement and follower tracking via the Meta Graph API using `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, and `INSTAGRAM_ACCESS_TOKEN`.
- **Facebook:** Page performance analytics using `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, and `FACEBOOK_ACCESS_TOKEN`.
- **YouTube:** Channel growth and video performance via YouTube Analytics API using `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REFRESH_TOKEN`.
- **Etsy:** Shop sales and traffic monitoring using `ETSY_API_KEY`, `ETSY_ACCESS_TOKEN`, and `ETSY_SHOP_ID`.
- **eBay:** Order and listing analytics via eBay APIs using `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, and `EBAY_REFRESH_TOKEN`.
- **Shopify:** Store performance and inventory sync via Admin API using `SHOPIFY_STORE_URL` and `SHOPIFY_ACCESS_TOKEN`.
- **Pinterest:** Profile and pin analytics using `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET`, and `PINTEREST_REFRESH_TOKEN`.
- **X / Twitter:** Automated tweet engagement tracking using `TWITTER_BEARER_TOKEN` and related OAuth 1.0a/2.0 credentials.
