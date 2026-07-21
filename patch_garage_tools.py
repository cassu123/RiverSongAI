import re

with open("core/tools.py", "r") as f:
    content = f.read()

garage_tools = """
    {
        "name": "get_vehicle_status",
        "description": "Get the current maintenance status and timeline for a vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle": {"type": "string", "description": "The vehicle nickname, make, model, or year."}
            },
            "required": ["vehicle"]
        }
    },
    {
        "name": "get_vehicle_spec",
        "description": "Get specific specs for a vehicle like torque, fluid type, volume, min/max.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle": {"type": "string", "description": "The vehicle name."},
                "item": {"type": "string", "description": "The part or fluid to get specs for (e.g. 'drain plug', 'oil')."}
            },
            "required": ["vehicle", "item"]
        }
    },
    {
        "name": "query_vehicle_manual",
        "description": "Search the owner's manual for a vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle": {"type": "string"},
                "question": {"type": "string"}
            },
            "required": ["vehicle", "question"]
        }
    },
    {
        "name": "record_odometer",
        "description": "Record a new odometer reading for a vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle": {"type": "string"},
                "value": {"type": "number"}
            },
            "required": ["vehicle", "value"]
        }
    },
    {
        "name": "find_parts",
        "description": "Find OEM and alternative parts for a vehicle job online.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle": {"type": "string"},
                "job": {"type": "string"}
            },
            "required": ["vehicle", "job"]
        }
    },"""

# Insert schemas
content = content.replace("TOOL_SCHEMAS = [", "TOOL_SCHEMAS = [" + garage_tools)

funcs = """
async def _resolve_vehicle(query: str, user_id: str):
    from vehicles.management import get_vehicles
    from core.family import resolve_module_owner
    from database.core import engine
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    owner_id = await resolve_module_owner(user_id, "maintenance")
    try:
        vehicles = get_vehicles(db, owner_id)
        if not vehicles:
            return None
        # simple fuzzy match
        query = query.lower()
        for v in vehicles:
            if v.nickname and query in v.nickname.lower(): return v.id
            if v.make and query in v.make.lower(): return v.id
            if v.model and query in v.model.lower(): return v.id
        # return first if only one
        if len(vehicles) == 1:
            return vehicles[0].id
        return None
    finally:
        db.close()

async def _exec_get_vehicle_status(args: dict, user_id: str) -> str:
    vid = args.get("vehicle_id") or await _resolve_vehicle(args.get("vehicle"), user_id)
    if not vid: return "Vehicle not found."
    from database.core import engine
    from sqlalchemy.orm import sessionmaker
    from api.routes.vehicles import get_maintenance_timeline
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        from core.family import resolve_module_owner
        owner_id = await resolve_module_owner(user_id, "maintenance")
        tl = get_maintenance_timeline(str(vid), None, None, db, owner_id)
        return str(tl)
    except Exception as e:
        return f"Error: {e}"
    finally:
        db.close()

async def _exec_get_vehicle_spec(args: dict, user_id: str) -> str:
    vid = args.get("vehicle_id") or await _resolve_vehicle(args.get("vehicle"), user_id)
    if not vid: return "Vehicle not found."
    from database.core import engine
    from sqlalchemy.orm import sessionmaker
    from vehicles.models import VehicleCheckPoint
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        cps = db.query(VehicleCheckPoint).filter(VehicleCheckPoint.vehicle_id == str(vid)).all()
        q = args.get("item", "").lower()
        for cp in cps:
            if q in cp.description.lower():
                return f"Specs for {cp.description}: Torque {cp.torque_ft_lb} ft-lb / {cp.torque_nm} nm, Fluid {cp.fluid_volume} {cp.expected_spec}"
        return "Spec not found."
    finally:
        db.close()

async def _exec_query_vehicle_manual(args: dict, user_id: str) -> str:
    vid = args.get("vehicle_id") or await _resolve_vehicle(args.get("vehicle"), user_id)
    if not vid: return "Vehicle not found."
    from providers.rag.rag_provider import RAGProvider
    rag = RAGProvider()
    res = await rag.query_documents(args.get("question", ""), where={"vehicle_id": str(vid)}, n_results=3)
    return str(res)

async def _exec_record_odometer(args: dict, user_id: str) -> str:
    vid = args.get("vehicle_id") or await _resolve_vehicle(args.get("vehicle"), user_id)
    if not vid: return "Vehicle not found."
    val = args.get("value")
    from database.core import engine
    from sqlalchemy.orm import sessionmaker
    from vehicles.models import UsageReading
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        db.add(UsageReading(vehicle_id=str(vid), value=val, source="manual"))
        db.commit()
        return f"Recorded odometer {val} for vehicle."
    finally:
        db.close()

async def _exec_find_parts(args: dict, user_id: str) -> str:
    vid = args.get("vehicle_id") or await _resolve_vehicle(args.get("vehicle"), user_id)
    if not vid: return "Vehicle not found."
    # AI lookup verified pipeline
    from core.tools import _exec_web_search
    return await _exec_web_search({"query": f"{args.get('vehicle')} {args.get('job')} OEM part number alternatives price"}, user_id)

"""

content += funcs

# Update router in execute_tool
content = content.replace(
    'elif tool_name == "list_vehicles":',
    """elif tool_name == "get_vehicle_status": return await _exec_get_vehicle_status(tool_input, user_id)
        elif tool_name == "get_vehicle_spec": return await _exec_get_vehicle_spec(tool_input, user_id)
        elif tool_name == "query_vehicle_manual": return await _exec_query_vehicle_manual(tool_input, user_id)
        elif tool_name == "record_odometer": return await _exec_record_odometer(tool_input, user_id)
        elif tool_name == "find_parts": return await _exec_find_parts(tool_input, user_id)
        elif tool_name == "list_vehicles":"""
)

# Modify log_vehicle_maintenance to resolve vehicle if context vehicle_id missing
log_tool_fix = """
    vehicle_id = context.get("vehicle_id")
    if not vehicle_id:
        vehicle_id = await _resolve_vehicle(args.get("vehicle", ""), user_id)
    if not vehicle_id:
        return "No vehicle_id in context and could not resolve vehicle."
"""
content = re.sub(
    r'vehicle_id = context\.get\("vehicle_id"\)\s+if not vehicle_id:\s+return {"error": "No vehicle_id in context\. Cannot log maintenance."}',
    log_tool_fix,
    content
)

with open("core/tools.py", "w") as f:
    f.write(content)
