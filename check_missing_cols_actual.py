import sqlite3
import sys
import importlib.util

def check_db(db_path, models_path):
    # load models
    spec = importlib.util.spec_from_file_location("mod", models_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["mod"] = mod
    spec.loader.exec_module(mod)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    missing = []
    
    for attr in dir(mod):
        val = getattr(mod, attr)
        if isinstance(val, type) and hasattr(val, "__tablename__"):
            table_name = val.__tablename__
            
            # get columns from db
            try:
                cursor.execute(f"PRAGMA table_info({table_name})")
                db_cols = {row[1].lower() for row in cursor.fetchall()}
            except sqlite3.OperationalError:
                print(f"Table {table_name} missing in {db_path}!")
                continue
                
            for col_name, col_obj in val.__mapper__.columns.items():
                if col_name.lower() not in db_cols:
                    missing.append(f"{table_name}.{col_name}")
                    
    conn.close()
    return missing

db_model_map = [
    ("./data/culinary.db", "culinary/models.py"),
    ("./data/inventory.db", "inventory/models.py"),
    ("./data/commerce.db", "commercial_inventory/models.py"),
    ("./data/vehicles.db", "vehicles/models.py")
]

for db, model in db_model_map:
    print(f"Checking {db}...")
    try:
        missing = check_db(db, model)
        if missing:
            print("  Missing columns:", missing)
        else:
            print("  All columns present.")
    except Exception as e:
        print(f"  Error: {e}")
