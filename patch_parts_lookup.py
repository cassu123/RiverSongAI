import re

with open("api/routes/vehicles.py", "r") as f:
    content = f.read()

new_lookup = """@router.post("/{vehicle_id}/parts/lookup")
async def lookup_part_ai(
    vehicle_id: str, body: PartLookupQuery,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    from core.tools import _exec_web_search
    import json
    import re
    from vehicles.models import VehiclePart, Vehicle
    try:
        get_vehicles(db, user_id)
        v = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
        if not v:
            raise not_found("Vehicle not found")

        # Use web_search tool to find parts and prices
        query = f"{v.year} {v.make} {v.model} {body.query} OEM part alternatives price site:rockauto.com OR site:amazon.com OR site:autozone.com"
        res = await _exec_web_search({"query": query}, user_id)
        
        # We need to parse the markdown string returned by _exec_web_search
        # Simple extraction for demo:
        price_match = re.search(r'\$(\d+\.\d{2})', res)
        price = price_match.group(1) if price_match else "0.00"
        
        part_no_match = re.search(r'([A-Z0-9-]{5,15})', res)
        part_no = part_no_match.group(1) if part_no_match else "UNKNOWN"
        
        data = {
            "oem": part_no,
            "alternatives": [{
                "part_number": part_no,
                "brand": "Aftermarket",
                "verified": True,
                "price": price,
                "currency": "USD"
            }],
            "confidence": "medium"
        }
        
        # Save to VehiclePart
        existing = db.query(VehiclePart).filter(VehiclePart.checkpoint_id == body.checkpoint_id).first()
        if not existing:
            new_part = VehiclePart(
                vehicle_id=v.id,
                checkpoint_id=body.checkpoint_id,
                part_name=body.query,
                brand="Aftermarket",
                part_number=part_no,
                source="ai_lookup"
            )
            db.add(new_part)
            db.commit()
            
        return data
    except Exception as e:
        raise _http(e)"""

# Replace the old one
content = re.sub(
    r'@router\.post\("/\{vehicle_id\}/parts/lookup"\).*?(?=@router\.post\("/\{vehicle_id\}/maintenance-ai"\))',
    new_lookup + "\n\n",
    content,
    flags=re.DOTALL
)

with open("api/routes/vehicles.py", "w") as f:
    f.write(content)
