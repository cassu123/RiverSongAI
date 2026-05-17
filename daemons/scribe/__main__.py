import asyncio
import logging
from daemons.scribe.scribe import ScribeDaemon

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    daemon = ScribeDaemon()
    try:
        asyncio.run(daemon.start())
    except KeyboardInterrupt:
        daemon.stop()
