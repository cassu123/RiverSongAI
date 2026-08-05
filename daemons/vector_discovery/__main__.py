import asyncio
from daemons.vector_discovery.listener import VectorDiscoveryDaemon

if __name__ == "__main__":
    daemon = VectorDiscoveryDaemon()
    try:
        asyncio.run(daemon.start())
    except KeyboardInterrupt:
        daemon.stop()
