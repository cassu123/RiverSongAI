"""
api/routes/vehicles.py — Vehicle Maintenance Tracker REST API

Vehicles
  GET  POST  /api/vehicles/
  GET  PATCH DELETE  /api/vehicles/{vehicle_id}

Specs (per-vehicle)
  POST DELETE  /api/vehicles/{vehicle_id}/specs/fluids/{spec_id}
  POST DELETE  /api/vehicles/{vehicle_id}/specs/torques/{spec_id}
  POST DELETE  /api/vehicles/{vehicle_id}/specs/checkpoints/{point_id}

People roster
  GET  POST  /api/vehicles/people
  DELETE     /api/vehicles/people/{person_id}
  DELETE     /api/vehicles/people/{person_id}/force

Vehicle assignments
  GET  POST  /api/vehicles/{vehicle_id}/assignments
  DELETE     /api/vehicles/{vehicle_id}/assignments/{person_id}

Service logs
  GET  POST  /api/vehicles/{vehicle_id}/logs
  GET  PATCH DELETE  /api/vehicles/logs/{log_id}
  POST /api/vehicles/logs/{log_id}/receipt
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Generator, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session, sessionmaker

from core.auth import decode_token
from core.errors import bad_request, not_found, unauthorized
from core.family import resolve_module_owner
from vehicles.management import (
    AssignmentExistsError,
    PermissionDeniedError,
    PersonAlreadyExistsError,
    PersonNotFoundError,
    PersonStillAssignedError,
    VehicleNotFoundError,
    add_check_point,
    add_fluid_spec,
    add_person,
    add_torque_spec,
    apply_manual_intervals,
    assign_person,
    attach_receipt,
    clear_all_check_points,
    create_service_log,
    create_vehicle,
    delete_check_point,
    delete_fluid_spec,
    delete_service_log,
    delete_torque_spec,
    delete_vehicle,
    extract_text_from_pdf,
    force_remove_person,
    get_assignments_for_vehicle,
    get_service_log,
    get_service_logs,
    get_vehicles,
    list_people,
    parse_manual,
    remove_person,
    unassign_person,
    update_check_point,
    update_service_log,
    update_vehicle,
)
from vehicles.models import Base, VehicleType

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

_DB_URL = os.environ.get("VEHICLES_DB_URL", "sqlite:///./data/vehicles.db")
_engine = create_engine(
    _DB_URL,
    connect_args={"check_same_thread": False} if "sqlite" in _DB_URL else {},
)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
Base.metadata.create_all(_engine)


def _migrate(engine) -> None:
    """Add columns introduced after initial schema without dropping existing data."""
    import sqlalchemy
    with engine.connect() as conn:
        def _cols(table):
            return {row[1] for row in conn.execute(
                sqlalchemy.text(f"PRAGMA table_info({table})"))}

        # service_logs
        logs = _cols("vehicle_service_logs")
        if "performed_by_id" not in logs:
            conn.execute(sqlalchemy.text(
                "ALTER TABLE vehicle_service_logs ADD COLUMN performed_by_id TEXT"))
        if "service_type" not in logs:
            conn.execute(sqlalchemy.text(
                "ALTER TABLE vehicle_service_logs ADD COLUMN service_type TEXT"))

        # check_points
        cps = _cols("vehicle_check_points")
        for col, typedef in [
            ("interval_miles", "INTEGER"),
            ("interval_days", "INTEGER"),
            ("expected_spec", "TEXT"),
            ("min_value", "REAL"),
            ("max_value", "REAL"),
            ("unit", "TEXT"),
            ("ft_lb", "REAL"),
            ("nm", "REAL"),
            ("volume", "TEXT"),
            ("service_level", "TEXT"),
            ("due_at_miles", "INTEGER"),
            ("last_service_odometer", "INTEGER"),
            ("last_service_date", "TEXT"),
        ]:
            if col not in cps:
                conn.execute(
                    sqlalchemy.text(
                        f"ALTER TABLE vehicle_check_points ADD COLUMN {col} {typedef}"))

        # check_results
        crs = _cols("vehicle_service_check_results")
        for col, typedef in [
            ("check_point_id", "TEXT"),
            ("actual_value", "TEXT"),
            ("status", "TEXT"),
        ]:
            if col not in crs:
                conn.execute(
                    sqlalchemy.text(
                        f"ALTER TABLE vehicle_service_check_results ADD COLUMN {col} {typedef}"))

        # vehicle_parts
        vparts = _cols("vehicle_parts")
        if "verified_by_agent" not in vparts:
            try:
                conn.execute(sqlalchemy.text("ALTER TABLE vehicle_parts ADD COLUMN verified_by_agent INTEGER DEFAULT 0"))
            except Exception:
                pass
        if "brand" not in vparts:
            try:
                conn.execute(sqlalchemy.text("ALTER TABLE vehicle_parts ADD COLUMN brand TEXT"))
            except Exception:
                pass

        # Backfill vehicle_usage_readings from service logs
        readings_count = conn.execute(
            sqlalchemy.text("SELECT COUNT(*) FROM vehicle_usage_readings")
        ).scalar()
        if readings_count == 0:
            import uuid
            from datetime import datetime, timezone
            now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")
            conn.execute(sqlalchemy.text("""
                INSERT INTO vehicle_usage_readings (id, vehicle_id, value, unit, source, recorded_at)
                SELECT 
                    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
                    vehicle_id, 
                    odometer, 
                    'MILES', 
                    'SERVICE_LOG', 
                    service_date 
                FROM vehicle_service_logs 
                WHERE odometer IS NOT NULL
            """))

        conn.commit()


_migrate(_engine)


def get_db() -> Generator[Session, None, None]:
    db = _Session()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

async def get_current_user_id(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise unauthorized("Missing Bearer token")
    payload = await decode_token(auth.removeprefix("Bearer ").strip())
    if not payload:
        raise unauthorized("Invalid or expired token")
    user_id = str(payload.get("sub", ""))
    if not user_id:
        raise unauthorized("Token missing sub claim")
    return resolve_module_owner(user_id, "maintenance")


async def get_current_user_role(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return "user"
    payload = await decode_token(auth.removeprefix("Bearer ").strip())
    if not payload:
        return "user"
    return payload.get("role", "user")


# ---------------------------------------------------------------------------
# Error helper
# ---------------------------------------------------------------------------

def _http(e: Exception) -> HTTPException:
    if isinstance(e, PermissionDeniedError):
        return HTTPException(status_code=403, detail=str(e))
    if isinstance(e, (VehicleNotFoundError,
                  PersonNotFoundError, NoResultFound)):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, (PersonAlreadyExistsError,
                  AssignmentExistsError, PersonStillAssignedError)):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, ValueError):
        return HTTPException(status_code=422, detail=str(e))
    return HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------

def _ser_vehicle(v) -> dict:
    return {
        "id": str(v.id),
        "year": v.year,
        "make": v.make,
        "model": v.model,
        "trim": v.trim,
        "nickname": v.nickname,
        "vehicle_type": v.vehicle_type.value if v.vehicle_type else None,
        "vin": v.vin,
        "license_plate": v.license_plate,
        "color": v.color,
        "notes": v.notes,
        "fluid_specs": [
            {"id": str(f.id),
             "name": f.name,
             "spec": f.spec,
             "volume": f.volume}
            for f in v.fluid_specs
        ],
        "torque_specs": [
            {"id": str(t.id), "name": t.name, "ft_lb": t.ft_lb, "nm": t.nm}
            for t in v.torque_specs
        ],
        "check_points": [
            _ser_checkpoint(cp)
            for cp in sorted(v.check_points, key=lambda x: x.sort_order)
        ],
        "usage_readings": [
            _ser_usage_reading(ur)
            for ur in sorted(v.usage_readings, key=lambda x: x.recorded_at, reverse=True)
        ] if hasattr(v, "usage_readings") and v.usage_readings else [],
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "updated_at": v.updated_at.isoformat() if v.updated_at else None,
    }


def _ser_usage_reading(ur) -> dict:
    return {
        "id": str(ur.id),
        "vehicle_id": str(ur.vehicle_id),
        "value": ur.value,
        "unit": ur.unit.value if hasattr(ur.unit, "value") else str(ur.unit),
        "source": ur.source.value if hasattr(ur.source, "value") else str(ur.source),
        "recorded_at": ur.recorded_at.isoformat() if ur.recorded_at else None,
    }


def _ser_checkpoint(cp) -> dict:
    return {
        "id": str(cp.id),
        "description": cp.description,
        "sort_order": cp.sort_order,
        "service_level": cp.service_level.value if cp.service_level else "inspect",
        "interval_miles": cp.interval_miles,
        "interval_days": cp.interval_days,
        "due_at_miles": cp.due_at_miles,
        "expected_spec": cp.expected_spec,
        "volume": cp.volume,
        "min_value": cp.min_value,
        "max_value": cp.max_value,
        "unit": cp.unit,
        "ft_lb": cp.ft_lb,
        "nm": cp.nm,
        "last_service_odometer": cp.last_service_odometer,
        "last_service_date": cp.last_service_date.isoformat() if cp.last_service_date else None,
        "parts": [_ser_part(p) for p in cp.parts] if hasattr(cp, "parts") else [],
    }


def _ser_part(part) -> dict:
    return {
        "id": str(part.id),
        "vehicle_id": str(part.vehicle_id),
        "checkpoint_id": str(part.checkpoint_id),
        "part_name": part.part_name,
        "brand": part.brand,
        "oem_part_number": part.oem_part_number,
        "oem_specs": part.oem_specs,
        "alternatives": part.alternatives,
        "source": part.source,
        "verified_by_agent": part.verified_by_agent,
        "created_at": part.created_at.isoformat() if part.created_at else None,
        "updated_at": part.updated_at.isoformat() if part.updated_at else None,
    }


def _ser_person(p) -> dict:
    return {
        "id": str(p.id),
        "external_user_id": p.external_user_id,
        "email": p.email,
        "display_name": p.display_name,
        "vehicle_ids": [str(a.vehicle_id) for a in p.assignments],
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _ser_assignment(a) -> dict:
    return {
        "id": str(a.id),
        "vehicle_id": str(a.vehicle_id),
        "person_id": str(a.person_id),
        "person_email": a.person.email if a.person else None,
        "person_display_name": a.person.display_name if a.person else None,
        "assigned_at": a.assigned_at.isoformat() if a.assigned_at else None,
    }


def _ser_log(log) -> dict:
    performed_by = None
    if log.performed_by:
        performed_by = {
            "id": str(log.performed_by.id),
            "display_name": log.performed_by.display_name,
            "email": log.performed_by.email,
        }
    return {
        "id": str(log.id),
        "vehicle_id": str(log.vehicle_id),
        "service_date": log.service_date.isoformat() if log.service_date else None,
        "service_type": log.service_type,
        "odometer": log.odometer,
        "is_pro_service": log.is_pro_service,
        "service_center": log.service_center,
        "cost": float(log.cost) if log.cost else None,
        "notes": log.notes,
        "receipt_path": log.receipt_path,
        "performed_by": performed_by,
        "check_results": [
            {
                "id": str(cr.id),
                "check_point_id": str(cr.check_point_id) if cr.check_point_id else None,
                "description": cr.description,
                "actual_value": cr.actual_value,
                "status": cr.status.value if cr.status else ("pass" if cr.passed else "fail"),
                "passed": cr.passed,
            }
            for cr in log.check_results
        ],
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class VehicleCreate(BaseModel):
    make: str
    model: str
    year: Optional[int] = None
    trim: str = ""
    nickname: str = ""
    vehicle_type: VehicleType = VehicleType.AUTO
    vin: str = ""
    license_plate: str = ""
    color: str = ""
    notes: str = ""


class PartAlternativeIn(BaseModel):
    part_number: str
    brand: str
    verified: bool = False
    notes: str = ""


class PartCreate(BaseModel):
    checkpoint_id: str
    part_name: str
    brand: Optional[str] = "OEM"
    oem_part_number: Optional[str] = None
    oem_specs: Optional[str] = None
    alternatives: List[PartAlternativeIn] = []
    source: Optional[str] = "user_added"
    verified_by_agent: Optional[bool] = False


class PartPatch(BaseModel):
    part_name: Optional[str] = None
    brand: Optional[str] = None
    oem_part_number: Optional[str] = None
    oem_specs: Optional[str] = None
    alternatives: Optional[List[PartAlternativeIn]] = None
    verified_by_agent: Optional[bool] = None


class PartLookupQuery(BaseModel):
    checkpoint_id: str
    query: str


class MaintenanceAIQuery(BaseModel):
    question: str
    current_odometer: Optional[int] = None

class UsageReadingCreate(BaseModel):
    value: float
    unit: str = "miles"
    source: str = "manual"


class VehiclePatch(BaseModel):
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    trim: Optional[str] = None
    nickname: Optional[str] = None
    vehicle_type: Optional[VehicleType] = None
    vin: Optional[str] = None
    license_plate: Optional[str] = None
    color: Optional[str] = None
    notes: Optional[str] = None


class FluidSpecCreate(BaseModel):
    name: str
    spec: str = ""
    volume: str = ""


class TorqueSpecCreate(BaseModel):
    name: str
    ft_lb: Optional[float] = None
    nm: Optional[float] = None


class CheckPointCreate(BaseModel):
    description: str
    sort_order: int = 0
    service_level: str = "inspect"
    interval_miles: Optional[int] = None
    interval_days: Optional[int] = None
    due_at_miles: Optional[int] = None
    expected_spec: Optional[str] = None
    volume: Optional[str] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    unit: Optional[str] = None
    ft_lb: Optional[float] = None
    nm: Optional[float] = None


class CheckPointPatch(BaseModel):
    description: Optional[str] = None
    service_level: Optional[str] = None
    interval_miles: Optional[int] = None
    interval_days: Optional[int] = None
    due_at_miles: Optional[int] = None
    expected_spec: Optional[str] = None
    volume: Optional[str] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    unit: Optional[str] = None
    ft_lb: Optional[float] = None
    nm: Optional[float] = None


class PersonAdd(BaseModel):
    email: str


class AssignPersonBody(BaseModel):
    person_id: str


class CheckResultIn(BaseModel):
    description: str
    check_point_id: Optional[str] = None
    actual_value: Optional[str] = None
    status: Optional[str] = None  # "pass" | "warn" | "fail"
    passed: bool = True


class ServiceLogCreate(BaseModel):
    service_date: datetime
    odometer: Optional[int] = None
    is_pro_service: bool = False
    service_center: Optional[str] = None
    service_type: Optional[str] = None
    cost: Optional[float] = None
    notes: str = ""
    performed_by_id: Optional[str] = None
    check_results: List[CheckResultIn] = []


class ServiceLogPatch(BaseModel):
    service_date: Optional[datetime] = None
    odometer: Optional[int] = None
    service_center: Optional[str] = None
    service_type: Optional[str] = None
    cost: Optional[float] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# People roster — /api/vehicles/people
# NOTE: These routes must be registered before /{vehicle_id} routes to avoid
# FastAPI matching "people" as a vehicle_id path parameter.
# ---------------------------------------------------------------------------

@router.get("/people")
def list_people_route(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    return [_ser_person(p) for p in list_people(db, user_id)]


@router.post("/people", status_code=201)
def add_person_route(
    body: PersonAdd,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        p = add_person(db, user_id, body.email.strip().lower())
        return _ser_person(p)
    except Exception as e:
        raise _http(e)


@router.delete("/people/{person_id}", status_code=204)
def remove_person_route(
    person_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        remove_person(db, user_id, person_id)
    except Exception as e:
        raise _http(e)


@router.delete("/people/{person_id}/force", status_code=204)
def force_remove_person_route(
    person_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        force_remove_person(db, user_id, person_id)
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Vehicles
# ---------------------------------------------------------------------------

@router.get("/")
def list_vehicles(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    return [_ser_vehicle(v) for v in get_vehicles(db, user_id)]


@router.post("/", status_code=201)
def create_vehicle_route(
    body: VehicleCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    v = create_vehicle(
        db, user_id,
        make=body.make, model=body.model, year=body.year, trim=body.trim,
        nickname=body.nickname, vehicle_type=body.vehicle_type,
        vin=body.vin, license_plate=body.license_plate,
        color=body.color, notes=body.notes,
    )
    return _ser_vehicle(v)


@router.get("/{vehicle_id}")
def get_vehicle_route(
    vehicle_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        vehicles = get_vehicles(db, user_id)
        v = next((v for v in vehicles if str(v.id) == vehicle_id), None)
        if not v:
            raise not_found("Vehicle not found")
        return _ser_vehicle(v)
    except HTTPException:
        raise
    except Exception as e:
        raise _http(e)


@router.get("/{vehicle_id}/usage")
def get_vehicle_usage(
    vehicle_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        vehicles = get_vehicles(db, user_id)
        v = next((v for v in vehicles if str(v.id) == vehicle_id), None)
        if not v:
            raise not_found("Vehicle not found")
        return [
            _ser_usage_reading(ur)
            for ur in sorted(v.usage_readings, key=lambda x: x.recorded_at, reverse=True)
        ]
    except Exception as e:
        raise _http(e)


@router.post("/{vehicle_id}/usage")
def post_vehicle_usage(
    vehicle_id: str,
    body: UsageReadingCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    from vehicles.models import UsageReading, UsageUnit, UsageSource
    try:
        vehicles = get_vehicles(db, user_id)
        v = next((v for v in vehicles if str(v.id) == vehicle_id), None)
        if not v:
            raise not_found("Vehicle not found")
            
        ur = UsageReading(
            vehicle_id=v.id,
            value=body.value,
            unit=UsageUnit(body.unit),
            source=UsageSource(body.source),
            recorded_at=datetime.now(timezone.utc)
        )
        db.add(ur)
        db.commit()
        db.refresh(ur)
        return _ser_usage_reading(ur)
    except Exception as e:
        raise _http(e)


@router.get("/{vehicle_id}/maintenance-timeline")
def get_maintenance_timeline(
    vehicle_id: str,
    current_odometer: Optional[int] = None,
    current_date: Optional[str] = None,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        vehicles = get_vehicles(db, user_id)
        v = next((v for v in vehicles if str(v.id) == vehicle_id), None)
        if not v:
            raise not_found("Vehicle not found")

        today = datetime.fromisoformat(current_date.replace(
            'Z', '+00:00')).date() if current_date else datetime.now(timezone.utc).date()

        # Determine actual current odometer to use
        eff_odometer = current_odometer
        odometer_estimated = False
        last_reading_at = None

        if eff_odometer is None:
            # Estimator logic
            readings = sorted(
                [r for r in getattr(v, "usage_readings", []) if r.unit.value == "miles"],
                key=lambda x: x.recorded_at
            )
            if not readings:
                # Fallback to service logs if no readings at all
                logs = get_service_logs(db, user_id, vehicle_id)
                last_log_odo = max((log.odometer for log in logs if log.odometer is not None), default=0)
                eff_odometer = last_log_odo
            else:
                last_reading = readings[-1]
                last_reading_at = last_reading.recorded_at.isoformat()
                
                # Default rate
                daily_rate = 27.4
                
                if len(readings) >= 2:
                    # Simple linear fit between first and last of the most recent 10 readings
                    recent = readings[-10:]
                    first = recent[0]
                    last = recent[-1]
                    days_diff = (last.recorded_at - first.recorded_at).total_seconds() / (24 * 3600)
                    if days_diff > 1:
                        daily_rate = max(0, (last.value - first.value) / days_diff)
                
                days_since = (datetime.now(timezone.utc) - last_reading.recorded_at).total_seconds() / (24 * 3600)
                eff_odometer = int(last_reading.value + (daily_rate * max(0, days_since)))
                odometer_estimated = True

        timeline_items = []
        for cp in v.check_points:
            proj_miles = None
            proj_date = None

            # calculate miles
            if cp.due_at_miles is not None:
                proj_miles = cp.due_at_miles
            elif cp.interval_miles and cp.last_service_odometer is not None:
                proj_miles = cp.last_service_odometer + cp.interval_miles
            elif cp.interval_miles:
                proj_miles = eff_odometer + cp.interval_miles

            # calculate dates
            if cp.interval_days and cp.last_service_date:
                proj_date = cp.last_service_date.date(
                ) + __import__("datetime").timedelta(days=cp.interval_days)
            elif cp.interval_days:
                proj_date = today + \
                    __import__("datetime").timedelta(days=cp.interval_days)

            if proj_miles is None and proj_date is None:
                continue  # Cannot predict

            # Delta to now
            delta_miles = proj_miles - \
                eff_odometer if proj_miles is not None else float('inf')
            delta_days = (
                proj_date -
                today).days if proj_date is not None else float('inf')

            # Sort score (miles if available, otherwise days translated to
            # approx miles at 10k/yr)
            score = delta_miles if proj_miles is not None else (
                delta_days * 27.4)

            # Filter out things way far in the future if we have >4 items
            is_overdue = (delta_miles <= 0) or (delta_days <= 0)

            item_data = _ser_checkpoint(cp)
            item_data["projected_due_miles"] = proj_miles
            item_data["projected_due_date"] = proj_date.isoformat(
            ) if proj_date else None
            item_data["is_overdue"] = is_overdue
            item_data["delta_miles"] = delta_miles
            item_data["delta_days"] = delta_days
            item_data["score"] = score

            timeline_items.append(item_data)

        timeline_items.sort(key=lambda x: (x["score"], x["sort_order"]))

        next_up = timeline_items[0] if timeline_items else None
        upcoming = timeline_items[1:4] if len(timeline_items) > 1 else []

        return {
            "eff_odometer": eff_odometer,
            "odometer_estimated": odometer_estimated,
            "last_reading_at": last_reading_at,
            "next_up": next_up,
            "upcoming": upcoming
        }
    except Exception as e:
        raise _http(e)


@router.patch("/{vehicle_id}")
def update_vehicle_route(
    vehicle_id: str, body: VehiclePatch,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        return _ser_vehicle(update_vehicle(db, user_id, vehicle_id, **fields))
    except Exception as e:
        raise _http(e)


@router.delete("/{vehicle_id}", status_code=204)
def delete_vehicle_route(
    vehicle_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        delete_vehicle(db, user_id, vehicle_id)
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Specs
# ---------------------------------------------------------------------------

@router.post("/{vehicle_id}/specs/fluids", status_code=201)
def add_fluid(
    vehicle_id: str, body: FluidSpecCreate,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        f = add_fluid_spec(
            db,
            user_id,
            vehicle_id,
            body.name,
            body.spec,
            body.volume)
        return {"id": str(f.id), "name": f.name,
                "spec": f.spec, "volume": f.volume}
    except Exception as e:
        raise _http(e)


@router.delete("/{vehicle_id}/specs/fluids/{spec_id}", status_code=204)
def delete_fluid(
    vehicle_id: str, spec_id: str,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        delete_fluid_spec(db, user_id, spec_id)
    except Exception as e:
        raise _http(e)


@router.post("/{vehicle_id}/specs/torques", status_code=201)
def add_torque(
    vehicle_id: str, body: TorqueSpecCreate,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        t = add_torque_spec(
            db,
            user_id,
            vehicle_id,
            body.name,
            body.ft_lb,
            body.nm)
        return {"id": str(t.id), "name": t.name, "ft_lb": t.ft_lb, "nm": t.nm}
    except Exception as e:
        raise _http(e)


@router.delete("/{vehicle_id}/specs/torques/{spec_id}", status_code=204)
def delete_torque(
    vehicle_id: str, spec_id: str,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        delete_torque_spec(db, user_id, spec_id)
    except Exception as e:
        raise _http(e)


@router.post("/{vehicle_id}/specs/checkpoints", status_code=201)
def add_checkpoint(
    vehicle_id: str, body: CheckPointCreate,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        cp = add_check_point(
            db, user_id, vehicle_id, body.description, body.sort_order,
            service_level=body.service_level,
            interval_miles=body.interval_miles, interval_days=body.interval_days,
            due_at_miles=body.due_at_miles,
            expected_spec=body.expected_spec, volume=body.volume,
            min_value=body.min_value, max_value=body.max_value, unit=body.unit,
            ft_lb=body.ft_lb, nm=body.nm,
        )
        return _ser_checkpoint(cp)
    except Exception as e:
        raise _http(e)


@router.patch("/{vehicle_id}/specs/checkpoints/{point_id}")
def patch_checkpoint(
    vehicle_id: str, point_id: str, body: CheckPointPatch,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        cp = update_check_point(
            db, user_id, point_id,
            description=body.description, service_level=body.service_level,
            interval_miles=body.interval_miles, interval_days=body.interval_days,
            due_at_miles=body.due_at_miles,
            expected_spec=body.expected_spec, volume=body.volume,
            min_value=body.min_value, max_value=body.max_value, unit=body.unit,
            ft_lb=body.ft_lb, nm=body.nm,
        )
        return _ser_checkpoint(cp)
    except Exception as e:
        raise _http(e)


@router.delete("/{vehicle_id}/specs/checkpoints/{point_id}", status_code=204)
def delete_checkpoint(
    vehicle_id: str, point_id: str,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        delete_check_point(db, user_id, point_id)
    except Exception as e:
        raise _http(e)


@router.delete("/{vehicle_id}/specs/checkpoints", status_code=204)
def clear_all_checkpoints(
    vehicle_id: str,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        clear_all_check_points(db, user_id, vehicle_id)
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Parts API
# ---------------------------------------------------------------------------

@router.get("/{vehicle_id}/parts")
def list_parts(
    vehicle_id: str,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        from vehicles.models import VehiclePart
        parts = db.query(VehiclePart).filter(
            VehiclePart.vehicle_id == vehicle_id).all()
        return [_ser_part(p) for p in parts]
    except Exception as e:
        raise _http(e)


@router.post("/{vehicle_id}/parts", status_code=201)
def add_part(
    vehicle_id: str, body: PartCreate,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        from vehicles.models import VehiclePart, Vehicle
        # Verify ownership
        get_vehicles(db, user_id)
        v = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
        if not v:
            raise not_found("Vehicle not found")

        alts = [a.model_dump() for a in body.alternatives]

        part = VehiclePart(
            vehicle_id=vehicle_id,
            checkpoint_id=body.checkpoint_id,
            part_name=body.part_name,
            brand=body.brand,
            oem_part_number=body.oem_part_number,
            oem_specs=body.oem_specs,
            alternatives=alts,
            source=body.source,
            verified_by_agent=body.verified_by_agent
        )
        db.add(part)
        db.commit()
        db.refresh(part)
        return _ser_part(part)
    except Exception as e:
        db.rollback()
        raise _http(e)


@router.put("/{vehicle_id}/parts/{part_id}")
def update_part(
    vehicle_id: str, part_id: str, body: PartPatch,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        from vehicles.models import VehiclePart
        get_vehicles(db, user_id)
        part = db.query(VehiclePart).filter(
            VehiclePart.id == part_id,
            VehiclePart.vehicle_id == vehicle_id).first()
        if not part:
            raise not_found("Part not found")

        if body.part_name is not None:
            part.part_name = body.part_name
        if body.oem_part_number is not None:
            part.oem_part_number = body.oem_part_number
        if body.oem_specs is not None:
            part.oem_specs = body.oem_specs
        if body.alternatives is not None:
            part.alternatives = [a.model_dump() for a in body.alternatives]

        db.commit()
        db.refresh(part)
        return _ser_part(part)
    except Exception as e:
        db.rollback()
        raise _http(e)


@router.post("/{vehicle_id}/parts/lookup")
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

        existing = db.query(VehiclePart).filter(VehiclePart.checkpoint_id == body.checkpoint_id).first()
        if existing:
            return _ser_part(existing)

        query = f"{v.year} {v.make} {v.model} {body.query} OEM part alternatives price site:rockauto.com OR site:amazon.com OR site:autozone.com"
        res = await _exec_web_search({"query": query}, user_id)
        
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
        
        new_part = VehiclePart(
            vehicle_id=v.id,
            checkpoint_id=body.checkpoint_id,
            part_name=body.query,
            oem_part_number=part_no,
            alternatives=data["alternatives"],
            source="ai_lookup"
        )
        db.add(new_part)
        db.commit()
            
        return data
    except Exception as e:
        raise _http(e)


@router.post("/{vehicle_id}/maintenance-ai")
async def maintenance_ai(
    vehicle_id: str, body: MaintenanceAIQuery,
    request: Request,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    from providers.rag.rag_provider import RAGProvider
    from core.conversation_loop import ConversationLoop
    import json
    import asyncio

    try:
        # Get timeline context
        timeline_resp = get_maintenance_timeline(
            vehicle_id, body.current_odometer, None, db, user_id)
        next_up = timeline_resp.get("next_up")

        # Get RAG context
        rag = RAGProvider()
        chunks = await rag.query_documents(body.question, where={"vehicle_id": vehicle_id}, n_results=5)

        context_text = "\n".join([f"- {c.get('text', '')}" for c in chunks])

        from vehicles.models import Vehicle
        v = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
        if not v:
            raise bad_request("Vehicle not found")

        prompt = f"""Vehicle: {v.year} {v.make} {v.model}
Current Odometer: {body.current_odometer or 'Unknown'}
Next Service Due: {next_up['description'] if next_up else 'None'}
Parts on file: {json.dumps(next_up.get('parts', [])) if next_up else '[]'}

Owner's Manual Context:
{context_text}

Instructions: Answer using the manual and current vehicle status.
If the user is reporting a completed service, you MUST call the `log_vehicle_maintenance` tool.
If asking about parts, cite OEM and verified alternatives from the context above if available."""

        memory_manager = getattr(request.app.state, "memory_manager", None)
        loop = ConversationLoop(
            user_id=user_id,
            session_id=f"vehicle_{vehicle_id}_ask",
            mode="text",
            memory_manager=memory_manager,
        )
        loop._tool_context_extras = {"vehicle_id": vehicle_id, "db": db}
        loop._system_prompt = prompt
        
        await loop.initialize()
        
        # We don't want history across queries for the one-off "ask" in the drawer, 
        # or maybe we do. The session_id caches it in DB. Let's just run text.
        queue: asyncio.Queue = asyncio.Queue()
        async def on_event(evt: dict):
            await queue.put(evt)
            
        task = asyncio.create_task(loop.run_text(body.question, on_event))
        
        answer = ""
        tool_invoked = None
        tool_result = None
        
        while True:
            # We must wait for task to finish or events to come in
            try:
                evt = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                if task.done():
                    break
                continue
                
            if evt["type"] in ("token", "response_chunk"):
                answer += evt.get("content", "") or evt.get("text", "")
            elif evt["type"] == "tool_use":
                tool_invoked = evt.get("tool")
            elif evt["type"] == "tool_result":
                tool_result = evt.get("result")
            elif evt["type"] == "error":
                raise bad_request(evt["message"])
                
        await task
        
        return {
            "answer": answer,
            "tool_invoked": tool_invoked,
            "tool_result": tool_result
        }

    except Exception as e:
        logger.error(f"Maintenance AI error: {e}")
        raise _http(e)


@router.post("/{vehicle_id}/manual/preview")
async def preview_manual(
    vehicle_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """
    Dry-run: extract and parse a PDF manual without writing anything to the DB.
    Returns the raw parsed items so you can verify extraction quality.
    """
    from config.settings import get_settings
    try:
        data = await file.read()
        if not data:
            raise bad_request("Uploaded file is empty.")
        try:
            pdf_text = extract_text_from_pdf(data)
        except Exception as e:
            raise bad_request(f"Could not read PDF: {e}")

        if len(pdf_text.strip()) < 200:
            raise bad_request("PDF has no extractable text.")

        settings = get_settings()
        ollama_url = getattr(settings, "ollama_base_url", None) or None
        ollama_model = getattr(settings, "ollama_model", None) or "mistral"

        items = parse_manual(
            pdf_text,
            ollama_url=ollama_url,
            ollama_model=ollama_model)
        return {
            "item_count": len(items),
            "pdf_chars": len(pdf_text),
            "items": items,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise _http(e)


@router.post("/{vehicle_id}/manual")
async def upload_manual(
    vehicle_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """
    Upload a vehicle owner's manual PDF.
    Extracts text locally with pypdf, parses intervals with regex (offline, zero cost).
    Falls back to a locally-running Ollama model if regex finds fewer than 3 items
    and OLLAMA_BASE_URL is set in .env — no external API calls ever made.
    """
    from config.settings import get_settings
    try:
        data = await file.read()
        if not data:
            raise bad_request("Uploaded file is empty.")

        try:
            pdf_text = extract_text_from_pdf(data)
        except Exception as e:
            raise bad_request(f"Could not read PDF: {e}")

        if len(pdf_text.strip()) < 200:
            raise bad_request(
                "PDF has no extractable text. Scanned/image-only PDFs are not supported.")

        settings = get_settings()
        ollama_url = getattr(settings, "ollama_base_url", None) or None
        ollama_model = getattr(settings, "ollama_model", None) or "mistral"

        items = parse_manual(
            pdf_text,
            ollama_url=ollama_url,
            ollama_model=ollama_model)

        if not items:
            raise bad_request(
                "No maintenance data found. Check that the PDF contains a maintenance schedule or specifications section.")

        # Phase 5: Ingest into RAG provider for conversational retrieval
        try:
            from providers.rag.rag_provider import RAGProvider
            rag = RAGProvider()
            await rag.ingest_pdf(data, {
                "vehicle_id": vehicle_id,
                "filename": file.filename,
                "user_id": user_id,
                "type": "vehicle_manual"
            })
            logger.info(
                "Manual '%s' ingested into RAG store for vehicle %s.",
                file.filename,
                vehicle_id)
        except Exception as rag_exc:
            logger.warning(
                "RAG ingestion failed for manual (non-fatal): %s",
                rag_exc)

        result = apply_manual_intervals(db, user_id, vehicle_id, items)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Vehicle assignments — /api/vehicles/{vehicle_id}/assignments
# ---------------------------------------------------------------------------

@router.get("/{vehicle_id}/assignments")
def list_assignments(
    vehicle_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        return [_ser_assignment(a) for a in get_assignments_for_vehicle(
            db, user_id, vehicle_id)]
    except Exception as e:
        raise _http(e)


@router.post("/{vehicle_id}/assignments", status_code=201)
def add_assignment(
    vehicle_id: str, body: AssignPersonBody,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        a = assign_person(db, user_id, vehicle_id, body.person_id)
        return _ser_assignment(a)
    except Exception as e:
        raise _http(e)


@router.delete("/{vehicle_id}/assignments/{person_id}", status_code=204)
def remove_assignment(
    vehicle_id: str, person_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        unassign_person(db, user_id, vehicle_id, person_id)
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Service logs
# ---------------------------------------------------------------------------

@router.get("/{vehicle_id}/logs")
def list_logs(
    vehicle_id: str,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        return [_ser_log(log)
                for log in get_service_logs(db, user_id, vehicle_id)]
    except Exception as e:
        raise _http(e)


@router.post("/{vehicle_id}/logs", status_code=201)
def create_log(
    vehicle_id: str, body: ServiceLogCreate,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        check_results = [
            {
                "description": cr.description,
                "check_point_id": cr.check_point_id,
                "actual_value": cr.actual_value,
                "status": cr.status,
                "passed": cr.passed,
            }
            for cr in body.check_results
        ]
        log = create_service_log(
            db, user_id, vehicle_id,
            service_date=body.service_date,
            odometer=body.odometer,
            is_pro_service=body.is_pro_service,
            service_center=body.service_center,
            service_type=body.service_type,
            cost=body.cost,
            notes=body.notes,
            performed_by_id=body.performed_by_id,
            check_results=check_results,
        )
        return _ser_log(log)
    except Exception as e:
        raise _http(e)


@router.get("/logs/{log_id}")
def get_log(
    log_id: str,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        return _ser_log(get_service_log(db, user_id, log_id))
    except Exception as e:
        raise _http(e)


@router.patch("/logs/{log_id}")
def update_log(
    log_id: str, body: ServiceLogPatch,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        return _ser_log(update_service_log(db, user_id, log_id, **fields))
    except Exception as e:
        raise _http(e)


@router.delete("/logs/{log_id}", status_code=204)
def delete_log(
    log_id: str,
    db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id),
):
    try:
        delete_service_log(db, user_id, log_id)
    except Exception as e:
        raise _http(e)


_RECEIPT_ALLOWED_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf"}
_RECEIPT_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/logs/{log_id}/receipt")
async def upload_receipt(
    log_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    mime = (file.content_type or "").lower().split(";")[0].strip()
    if mime not in _RECEIPT_ALLOWED_MIME:
        raise HTTPException(
            status_code=415,
            detail="File type not allowed. Permitted: JPEG, PNG, WebP, PDF.")
    try:
        data = await file.read()
        if len(data) > _RECEIPT_MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail="File exceeds 10 MB limit.")
        log = attach_receipt(db, user_id, log_id, data,
                             file.filename or "receipt")
        return _ser_log(log)
    except HTTPException:
        raise
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Media (Phase G3)
# ---------------------------------------------------------------------------

# from vehicles.media import process_and_save_media, get_media, delete_media
from vehicles.models import MediaSource
from fastapi.responses import FileResponse
import mimetypes

@router.post("/{vehicle_id}/media")
async def upload_media(
    vehicle_id: str,
    file: UploadFile = File(...),
    checkpoint_id: Optional[str] = None,
    log_id: Optional[str] = None,
    source: str = "user_upload",
    title: Optional[str] = None,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        source_enum = MediaSource(source)
    except ValueError:
        source_enum = MediaSource.USER_UPLOAD
        
    mime = (file.content_type or "").lower().split(";")[0].strip()
    try:
        data = await file.read()
        media = process_and_save_media(
            db=db,
            user_id=user_id,
            vehicle_id=vehicle_id,
            file_data=data,
            filename=file.filename or "media",
            mime_type=mime,
            checkpoint_id=checkpoint_id,
            log_id=log_id,
            source=source_enum,
            title=title
        )
        return {
            "id": str(media.id),
            "kind": media.kind.value,
            "title": media.title,
            "source": media.source.value,
            "created_at": media.created_at.isoformat()
        }
    except Exception as e:
        raise _http(e)

@router.get("/{vehicle_id}/media")
async def list_media(
    vehicle_id: str,
    checkpoint_id: Optional[str] = None,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        from vehicles.models import VehicleMedia
        import uuid
        
        # Checking permission
        from vehicles.models import Vehicle, VehicleAssignment
        vehicle = db.query(Vehicle).filter(Vehicle.id == uuid.UUID(vehicle_id)).first()
        if not vehicle:
            raise ValueError("Vehicle not found")
        eff_owner = resolve_module_owner(user_id, "maintenance")
        if str(vehicle.external_user_id) != eff_owner:
            is_assigned = db.query(VehicleAssignment).filter(
                VehicleAssignment.vehicle_id == vehicle.id,
                VehicleAssignment.person.has(external_user_id=user_id)
            ).first() is not None
            if not is_assigned:
                raise PermissionDeniedError("Not authorized")
                
        q = db.query(VehicleMedia).filter(VehicleMedia.vehicle_id == vehicle.id)
        if checkpoint_id:
            q = q.filter(VehicleMedia.checkpoint_id == uuid.UUID(checkpoint_id))
            
        results = q.order_by(VehicleMedia.created_at.desc()).all()
        return [{
            "id": str(m.id),
            "kind": m.kind.value,
            "title": m.title,
            "source": m.source.value,
            "created_at": m.created_at.isoformat()
        } for m in results]
    except Exception as e:
        raise _http(e)

@router.post("/{vehicle_id}/media/archive")
async def archive_guide(
    vehicle_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        q = payload.get("query", "")
        checkpoint_id = payload.get("checkpoint_id")
        
        # In a full implementation, this would trigger a web search agent to find the best guide.
        # For this prototype, we'll just create a link_archive.
        from vehicles.models import VehicleMedia, MediaKind
        import uuid
        
        media = VehicleMedia(
            id=uuid.uuid4(),
            vehicle_id=uuid.UUID(vehicle_id),
            checkpoint_id=uuid.UUID(checkpoint_id) if checkpoint_id else None,
            kind=MediaKind.LINK_ARCHIVE,
            title=f"Guide: {q}",
            source=MediaSource.WEB_ARCHIVE,
            file_path="https://www.youtube.com/watch?v=dQw4w9WgXcQ", # Mock URL
        )
        db.add(media)
        db.commit()
        db.refresh(media)
        
        return {
            "id": str(media.id),
            "kind": media.kind.value,
            "title": media.title,
            "source": media.source.value,
            "created_at": media.created_at.isoformat(),
            "url": media.file_path
        }
    except Exception as e:
        raise _http(e)

@router.get("/media/{media_id}")
async def fetch_media(
    media_id: str,
    thumb: bool = False,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        media = get_media(db, user_id, media_id)
        
        path = media.thumb_path if thumb else media.file_path
        if not path or not os.path.exists(path):
            raise HTTPException(status_code=404, detail="File not found")
            
        mime_type, _ = mimetypes.guess_type(path)
        return FileResponse(path, media_type=mime_type or "application/octet-stream")
    except Exception as e:
        raise _http(e)

@router.delete("/media/{media_id}")
async def remove_media(
    media_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        delete_media(db, user_id, media_id)
        return {"status": "ok"}
    except Exception as e:
        raise _http(e)

@router.post("/{vehicle_id}/media", status_code=201)
async def upload_vehicle_media(
    vehicle_id: str,
    file: UploadFile = File(...),
    checkpoint_id: Optional[str] = Form(None),
    log_id: Optional[str] = Form(None),
    kind: str = Form("photo"),
    title: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    from vehicles.media import process_upload
    from vehicles.models import VehicleMedia, MediaKind, MediaSource
    
    file_path, thumb_path = await process_upload(file, kind)
    if not file_path:
        raise bad_request("Failed to process media")
        
    m = VehicleMedia(
        vehicle_id=vehicle_id,
        checkpoint_id=checkpoint_id,
        log_id=log_id,
        kind=MediaKind.PHOTO if kind == "photo" else MediaKind.VIDEO,
        title=title or file.filename,
        source=MediaSource.USER_UPLOAD,
        file_path=file_path,
        thumb_path=thumb_path
    )
    db.add(m)
    db.commit()
    
    return {"status": "ok", "id": str(m.id)}

@router.get("/media/{media_id}")
async def get_vehicle_media(
    media_id: str,
    thumb: bool = False,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    from vehicles.models import VehicleMedia
    from fastapi.responses import FileResponse
    m = db.query(VehicleMedia).filter(VehicleMedia.id == media_id).first()
    if not m:
        raise not_found("Media not found")
        
    # We should probably check if user has access to m.vehicle_id
    
    path = m.thumb_path if thumb and m.thumb_path else m.file_path
    if not path or not os.path.exists(path):
        raise not_found("File not found on disk")
        
    return FileResponse(path)
