import asyncio
import sqlite3
import uuid
from datetime import datetime, timezone
import bcrypt

async def init_db():
    db_path = "data/river_song.db"
    conn = sqlite3.connect(db_path)
    
    # Import DDL from store
    import sys
    sys.path.insert(0, '.')
    from providers.memory.sqlite_store import _DDL
    
    conn.executescript(_DDL)
    
    # Create admin user
    email = "admin@example.com"
    password = "password123456" # > 12 chars
    pwd_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    user_id = str(uuid.uuid4())
    now = datetime.now(tz=timezone.utc).isoformat()
    
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role, is_approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, email, pwd_hash, "Admin", "admin", 1, now, now)
        )
        conn.commit()
        print(f"Created admin user: {email}")
    except sqlite3.IntegrityError:
        print("Admin user already exists.")
    
    conn.close()

if __name__ == "__main__":
    asyncio.run(init_db())
