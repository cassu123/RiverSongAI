import asyncio
from daemons.mechanic.mechanic import MechanicDaemon

if __name__ == "__main__":
    daemon = MechanicDaemon()
    try:
        asyncio.run(daemon.start())
    except KeyboardInterrupt:
        daemon.stop()
