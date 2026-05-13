import asyncio
from daemons.herald.herald import HeraldDaemon

if __name__ == "__main__":
    daemon = HeraldDaemon()
    try:
        asyncio.run(daemon.start())
    except KeyboardInterrupt:
        daemon.stop()
