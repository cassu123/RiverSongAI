# =============================================================================
# providers/reading/__init__.py
#
# Reading app provider package for River Song AI.
#
# Modules:
#   audible - Audible audiobook library and playback launcher.
#             Authenticates via the audible Python library (device registration).
#             Lists library, retrieves last-listened book, and opens Audible
#             in the system browser or app to resume playback.
#   libby   - Libby/OverDrive library holds and loans.
#             Authenticates via Libby's chip (device UUID) system.
#             Lists current loans and holds queue with expiry and wait info.
#
# Setup:
#   Audible - Run the one-time auth script before first use:
#               python -m providers.reading.audible --setup
#             Follow the prompts to log in. Auth is saved to the path
#             set by AUDIBLE_AUTH_FILE_PATH in .env.
#   Libby   - Run the one-time chip registration script before first use:
#               python -m providers.reading.libby --setup
#             Enter the 8-digit code shown in Libby (Settings -> Copy to
#             Another Device). The chip UUID is saved to LIBBY_CHIP_PATH.
# =============================================================================
