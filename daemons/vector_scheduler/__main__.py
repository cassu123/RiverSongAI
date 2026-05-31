import asyncio
from daemons.vector_scheduler.scheduler import VectorSchedulerDaemon

if __name__ == "__main__":
    daemon = VectorSchedulerDaemon()
    try:
        asyncio.run(daemon.start())
    except KeyboardInterrupt:
        daemon.stop()
