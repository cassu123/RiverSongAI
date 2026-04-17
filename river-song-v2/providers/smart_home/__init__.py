# =============================================================================
# providers/smart_home/__init__.py
#
# Smart home provider package for River Song AI.
#
# Modules:
#   home_assistant  - REST client for the Home Assistant API (lights, locks,
#                     covers, thermostats, fans, switches, scenes, scripts).
#   device_registry - Maps plain-English device names to HA entity IDs.
#                     Supports single entities and named groups. Fuzzy matching
#                     handles minor name variations ("living room light" vs
#                     "living room lights").
#
# Setup (one-time):
#   1. Generate a long-lived access token in HA:
#      Profile -> Security -> Long-lived access tokens -> Create token.
#   2. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN in .env.
#   3. Copy config_files/device_registry.example.json to
#      config_files/device_registry.json and fill in your entity IDs.
#      Entity IDs are visible in HA: Settings -> Devices & Services -> Entities.
#
# Supported device domains:
#   light, switch, fan, cover (garage/shades), lock, climate (thermostat),
#   input_boolean, scene, script, media_player
# =============================================================================
