import asyncio
from providers.memory.sqlite_store import SQLiteStore
async def main():
    store = SQLiteStore()
    unit = await store.get_vector_unit('VOY-RV-001')
    print("UNIT:", unit)
asyncio.run(main())
