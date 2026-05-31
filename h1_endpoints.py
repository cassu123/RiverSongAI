@router.post("/units/{id}/rotate-token", dependencies=[Depends(require_role("admin"))])
async def rotate_token(id: str):
    import secrets
    import base64
    store = SQLiteStore()
    new_token = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("utf-8").rstrip("=")
    await store.execute_write_async("UPDATE vector_units SET unit_token=? WHERE unit_id=?", (new_token, id))
    return {"status": "ok", "unit_token": new_token}

@router.get("/units/{id}/telemetry", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit_telemetry(id: str, limit: int = 100):
    store = SQLiteStore()
    return await store.execute_read_async("SELECT * FROM vector_telemetry WHERE unit_id=? ORDER BY timestamp DESC LIMIT ?", (id, limit))

@router.get("/units/{id}/alerts", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit_alerts(id: str, limit: int = 100):
    store = SQLiteStore()
    return await store.execute_read_async("SELECT * FROM vector_alerts WHERE unit_id=? ORDER BY timestamp DESC LIMIT ?", (id, limit))

@router.post("/units/{id}/alerts/{alert_id}/ack", dependencies=[Depends(require_role("operator", "admin"))])
async def ack_unit_alert(id: str, alert_id: str, request: Request):
    user_id = request.state.user["sub"]
    store = SQLiteStore()
    now = datetime.now(timezone.utc).isoformat()
    await store.execute_write_async("UPDATE vector_alerts SET acknowledged=1, acknowledged_at=?, acknowledged_by=? WHERE alert_id=? AND unit_id=?", (now, user_id, alert_id, id))
    return {"status": "ok"}

@router.get("/units/{id}/events", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit_events(id: str, limit: int = 100):
    store = SQLiteStore()
    return await store.execute_read_async("SELECT * FROM vector_session_events WHERE unit_id=? ORDER BY timestamp DESC LIMIT ?", (id, limit))

@router.get("/units/{id}/sessions", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit_sessions(id: str, limit: int = 100):
    store = SQLiteStore()
    return await store.execute_read_async("SELECT * FROM vector_sessions WHERE unit_id=? ORDER BY started_at DESC LIMIT ?", (id, limit))

@router.get("/units/{id}/camera/{camera_name}/snapshot", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit_snapshot(id: str, camera_name: str):
    raise HTTPException(status_code=404, detail="Snapshot not found")

@router.get("/sessions/{id}", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_session(id: str):
    store = SQLiteStore()
    session = await store.execute_read_one_async("SELECT * FROM vector_sessions WHERE session_id=?", (id,))
    if not session:
        raise HTTPException(404)
    events = await store.execute_read_async("SELECT * FROM vector_session_events WHERE session_id=? ORDER BY timestamp DESC LIMIT 100", (id,))
    telemetry = await store.execute_read_async("SELECT * FROM vector_telemetry WHERE unit_id=? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC", (session["unit_id"], session["started_at"], session.get("ended_at") or datetime.now(timezone.utc).isoformat()))
    sampled = []
    last_time = None
    for t in telemetry:
        ts = datetime.fromisoformat(t["timestamp"])
        if last_time is None or (ts - last_time).total_seconds() >= 30:
            sampled.append(t)
            last_time = ts
    session["events"] = events
    session["telemetry"] = sampled
    return session

class ZoneBody(BaseModel):
    name: str
    boundary: List[List[float]]
    no_go_areas: List[List[List[float]]] = []
    area_sqm: float
    capture_method: str = "drawn"

@router.post("/zones", dependencies=[Depends(require_role("operator", "admin"))])
async def create_zone(body: ZoneBody):
    store = SQLiteStore()
    zone_id = uuid.uuid4().hex
    await store.execute_write_async("INSERT INTO vector_zones (zone_id, name, boundary, no_go_areas, area_sqm, capture_method) VALUES (?, ?, ?, ?, ?, ?)", (zone_id, body.name, json.dumps(body.boundary), json.dumps(body.no_go_areas), body.area_sqm, body.capture_method))
    return {"zone_id": zone_id}

@router.get("/zones/{id}", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_zone(id: str):
    res = await SQLiteStore().execute_read_one_async("SELECT * FROM vector_zones WHERE zone_id=?", (id,))
    if not res: raise HTTPException(404)
    return res

@router.patch("/zones/{id}", dependencies=[Depends(require_role("operator", "admin"))])
async def patch_zone(id: str, body: dict):
    updates = {k: json.dumps(v) if isinstance(v, list) else v for k, v in body.items() if k in ["name", "boundary", "no_go_areas", "area_sqm", "capture_method"]}
    if not updates: return {"status": "ok"}
    cols = ", ".join([f"{k}=?" for k in updates.keys()])
    params = list(updates.values()) + [id]
    await SQLiteStore().execute_write_async(f"UPDATE vector_zones SET {cols} WHERE zone_id=?", tuple(params))
    return {"status": "ok"}

@router.delete("/zones/{id}", dependencies=[Depends(require_role("admin"))])
async def delete_zone(id: str):
    await SQLiteStore().execute_write_async("DELETE FROM vector_zones WHERE zone_id=?", (id,))
    return {"status": "ok"}

class ProgramBody(BaseModel):
    name: str
    assigned_unit_id: Optional[str] = None
    zone_ids: List[str]
    pattern: str = "stripes"
    direction_deg: float = 0
    overlap_pct: float = 10
    obstacle_clearance_m: float = 0.3
    edge_distance_m: float = 0.15
    speed_profile: str = "normal"

@router.post("/programs", dependencies=[Depends(require_role("operator", "admin"))])
async def create_program(body: ProgramBody):
    store = SQLiteStore()
    if body.assigned_unit_id:
        unit = await store.get_vector_unit(body.assigned_unit_id)
        if unit:
            sf = json.loads(unit.get("safety_floors", "{}") or "{}")
            if body.obstacle_clearance_m < sf.get("min_obstacle_clearance_m", 0.0):
                raise HTTPException(400, "obstacle_clearance_m violates unit safety floor")
    pid = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    await store.execute_write_async("INSERT INTO vector_programs (program_id, name, assigned_unit_id, zone_ids, pattern, direction_deg, overlap_pct, obstacle_clearance_m, edge_distance_m, speed_profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (pid, body.name, body.assigned_unit_id, json.dumps(body.zone_ids), body.pattern, body.direction_deg, body.overlap_pct, body.obstacle_clearance_m, body.edge_distance_m, body.speed_profile, now, now))
    return {"program_id": pid}

@router.get("/programs/{id}", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_program(id: str):
    res = await SQLiteStore().execute_read_one_async("SELECT * FROM vector_programs WHERE program_id=?", (id,))
    if not res: raise HTTPException(404)
    return res

@router.patch("/programs/{id}", dependencies=[Depends(require_role("operator", "admin"))])
async def patch_program(id: str, body: dict):
    store = SQLiteStore()
    prog = await store.execute_read_one_async("SELECT * FROM vector_programs WHERE program_id=?", (id,))
    if not prog: raise HTTPException(404)
    assigned_unit_id = body.get("assigned_unit_id", prog["assigned_unit_id"])
    obstacle_clearance_m = body.get("obstacle_clearance_m", prog["obstacle_clearance_m"])
    if assigned_unit_id:
        unit = await store.get_vector_unit(assigned_unit_id)
        if unit:
            sf = json.loads(unit.get("safety_floors", "{}") or "{}")
            if obstacle_clearance_m < sf.get("min_obstacle_clearance_m", 0.0):
                raise HTTPException(400, "obstacle_clearance_m violates unit safety floor")
    updates = {k: json.dumps(v) if isinstance(v, list) else v for k, v in body.items() if k in ["name", "assigned_unit_id", "zone_ids", "pattern", "direction_deg", "overlap_pct", "obstacle_clearance_m", "edge_distance_m", "speed_profile"]}
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        cols = ", ".join([f"{k}=?" for k in updates.keys()])
        params = list(updates.values()) + [id]
        await store.execute_write_async(f"UPDATE vector_programs SET {cols} WHERE program_id=?", tuple(params))
        if assigned_unit_id:
            await store.bump_config_revision(assigned_unit_id)
            from api.routes.vector_fleet import _get_command_event
            _get_command_event(assigned_unit_id).set()
            _get_command_event(assigned_unit_id).clear()
    return {"status": "ok"}

@router.delete("/programs/{id}", dependencies=[Depends(require_role("admin"))])
async def delete_program(id: str):
    await SQLiteStore().execute_write_async("DELETE FROM vector_programs WHERE program_id=?", (id,))
    return {"status": "ok"}

@router.post("/programs/{id}/run", dependencies=[Depends(require_role("operator", "admin"))])
async def run_program(id: str, request: Request):
    user_id = request.state.user["sub"]
    store = SQLiteStore()
    prog = await store.execute_read_one_async("SELECT * FROM vector_programs WHERE program_id=?", (id,))
    if not prog or not prog["assigned_unit_id"]:
        raise HTTPException(400, "Program not found or has no assigned unit")
    
    cmd_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    await store.execute_write_async(
        "INSERT INTO vector_commands (command_id, unit_id, issued_by, issued_at, action, params, status, ttl_seconds) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
        (cmd_id, prog["assigned_unit_id"], user_id, now, "mow_start", "{}", 30)
    )
    from api.routes.vector_fleet import _get_command_event
    _get_command_event(prog["assigned_unit_id"]).set()
    _get_command_event(prog["assigned_unit_id"]).clear()
    return {"command_id": cmd_id}

class ScheduleBody(BaseModel):
    program_id: str
    cron_expr: str
    timezone: str = "UTC"
    missed_run_policy: str = "skip"
    enabled: int = 1

@router.post("/schedules", dependencies=[Depends(require_role("operator", "admin"))])
async def create_schedule(body: ScheduleBody):
    sid = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    await SQLiteStore().execute_write_async("INSERT INTO vector_schedules (schedule_id, program_id, cron_expr, timezone, missed_run_policy, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (sid, body.program_id, body.cron_expr, body.timezone, body.missed_run_policy, body.enabled, now, now))
    return {"schedule_id": sid}

@router.get("/schedules/{id}", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_schedule(id: str):
    res = await SQLiteStore().execute_read_one_async("SELECT * FROM vector_schedules WHERE schedule_id=?", (id,))
    if not res: raise HTTPException(404)
    return res

@router.patch("/schedules/{id}", dependencies=[Depends(require_role("operator", "admin"))])
async def patch_schedule(id: str, body: dict):
    updates = {k: v for k, v in body.items() if k in ["program_id", "cron_expr", "timezone", "missed_run_policy", "enabled"]}
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        cols = ", ".join([f"{k}=?" for k in updates.keys()])
        params = list(updates.values()) + [id]
        await SQLiteStore().execute_write_async(f"UPDATE vector_schedules SET {cols} WHERE schedule_id=?", tuple(params))
    return {"status": "ok"}

@router.delete("/schedules/{id}", dependencies=[Depends(require_role("admin"))])
async def delete_schedule(id: str):
    await SQLiteStore().execute_write_async("DELETE FROM vector_schedules WHERE schedule_id=?", (id,))
    return {"status": "ok"}
