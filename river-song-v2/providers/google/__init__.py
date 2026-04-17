# =============================================================================
# providers/google/__init__.py
#
# Google Services provider package for River Song AI.
#
# Modules in this package:
#   auth          - OAuth 2.0 authorization flow and credential management
#   calendar      - Google Calendar: list and create events
#   gmail         - Gmail: read and send messages
#   youtube_music - YouTube Music: search and playback
#   maps          - Google Maps: geocoding and directions
#
# All modules require valid Google OAuth credentials obtained via auth.py.
# Run the standalone authorize script once per user before using any provider:
#
#   python -m providers.google.auth --user-id primary_user
#
# Scopes required (all declared in auth.py):
#   https://www.googleapis.com/auth/calendar
#   https://www.googleapis.com/auth/gmail.modify
#   https://www.googleapis.com/auth/drive.readonly
#   https://www.googleapis.com/auth/youtube
# =============================================================================
