import asyncio
from daemons.sifter.sifter import SifterDaemon

if __name__ == "__main__":
    daemon = SifterDaemon()
    try:
        asyncio.run(daemon.start())
    except KeyboardInterrupt:
        daemon.stop()
