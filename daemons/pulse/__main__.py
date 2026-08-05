import asyncio
from daemons.pulse.pulse import PulseDaemon

if __name__ == "__main__":
    daemon = PulseDaemon()
    try:
        asyncio.run(daemon.start())
    except KeyboardInterrupt:
        daemon.stop()
