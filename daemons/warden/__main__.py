import asyncio
from daemons.warden.warden import WardenDaemon

if __name__ == "__main__":
    daemon = WardenDaemon()
    try:
        asyncio.run(daemon.start())
    except KeyboardInterrupt:
        daemon.stop()
