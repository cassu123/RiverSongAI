import inspect
from providers.memory.sqlite_store import SQLiteStore

store = SQLiteStore()
methods = [m[0] for m in inspect.getmembers(store, predicate=inspect.ismethod) if not m[0].startswith('_')]
print("\n".join(methods))
