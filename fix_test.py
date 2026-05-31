import sqlite3
conn = sqlite3.connect("/mnt/data/river-song/db/river_song.db")
c = conn.cursor()
c.execute("UPDATE vector_programs SET assigned_unit_id = 'VOY-RV-001' WHERE program_id = '35c5231c1fea41f6ba9913b707e4449e'")
c.execute("INSERT OR IGNORE INTO vector_units (unit_id, name, status, created_at, updated_at) VALUES ('VOY-RV-001', 'Voyager', 'offline', '2026-05-31T00:00:00', '2026-05-31T00:00:00')")
conn.commit()
conn.close()
