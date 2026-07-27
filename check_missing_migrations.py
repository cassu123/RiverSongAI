import re
import ast

def get_add_columns_from_migrate(filepath):
    added = set()
    with open(filepath) as f:
        content = f.read()
    
    # look for ADD COLUMN
    matches = re.findall(r"ALTER TABLE\s+([a-zA-Z0-9_]+)\s+ADD COLUMN\s+([a-zA-Z0-9_]+)", content, re.IGNORECASE)
    for table, col in matches:
        added.add(f"{table.lower()}.{col.lower()}")
    return added

def get_columns_from_sqlalchemy_models(models_path):
    import importlib.util
    import sys
    spec = importlib.util.spec_from_file_location("mod", models_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["mod"] = mod
    spec.loader.exec_module(mod)
    
    cols = []
    # get all classes that subclass Base
    for attr in dir(mod):
        val = getattr(mod, attr)
        if isinstance(val, type) and hasattr(val, "__tablename__"):
            table_name = val.__tablename__
            for col_name, col_obj in val.__mapper__.columns.items():
                cols.append(f"{table_name.lower()}.{col_name.lower()}")
    return set(cols)

pairs = [
    ("api/routes/culinary.py", "culinary/models.py"),
    ("api/routes/inventory.py", "inventory/models.py"),
    ("api/routes/commerce.py", "commercial_inventory/models.py"),
    ("api/routes/vehicles.py", "vehicles/models.py")
]

for route_file, model_file in pairs:
    print(f"--- Checking {route_file} against {model_file} ---")
    migrated_cols = get_add_columns_from_migrate(route_file)
    try:
        model_cols = get_columns_from_sqlalchemy_models(model_file)
    except Exception as e:
        print(f"Error loading {model_file}: {e}")
        continue
    
    # Now we need to know what was in the INITIAL schema. 
    # Since we can't easily parse git history, let's just print ALL columns not in migrated_cols
    # and we can manually review which ones look "new"
    
    missing = model_cols - migrated_cols
    print(f"Total columns: {len(model_cols)}, Migrated: {len(migrated_cols)}")
    print("Columns not in _migrate (could be initial schema, could be missing!):")
    for c in sorted(missing):
        print("  " + c)
