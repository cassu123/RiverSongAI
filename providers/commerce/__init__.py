# =============================================================================
# providers/commerce/__init__.py
#
# Commerce automation provider package for River Song AI.
#
# Modules:
#   amazon  - Amazon Selling Partner API (SP-API).
#             Inventory summaries, low-stock detection, order queries.
#             Requires AWS IAM credentials + LWA OAuth refresh token.
#   walmart - Walmart Marketplace Seller API.
#             Inventory queries and order status.
#             Requires Walmart developer OAuth2 client credentials.
#
# Both providers run parallel to the conversation loop rather than inside it.
# They are reachable via voice ("what are my low stock items") through the
# intent router, and can also be called directly on a schedule.
#
# Setup:
#   Amazon  -- See docs/api_registry/amazon_seller.txt
#   Walmart -- See docs/api_registry/walmart_seller.txt
# =============================================================================
