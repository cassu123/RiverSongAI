"""
vehicles/management.py

Business-logic layer for the Maintenance Pulse vehicle tracker.

Functions
---------
Vehicles
  get_vehicles / create_vehicle / update_vehicle / delete_vehicle

Specs (fluid, torque, checkpoint)
  add_fluid_spec / delete_fluid_spec
  add_torque_spec / delete_torque_spec
  add_check_point / delete_check_point

People roster (scoped to garage owner)
  lookup_app_user_by_email   — check main river_song.db for approved user
  list_people                — list all persons in owner's roster
  add_person                 — add an approved app user by email
  remove_person              — delete person (fails if still assigned)
  force_remove_person        — unassign from all vehicles then delete

Vehicle assignments (many-to-many)
  get_assignments_for_vehicle — list persons assigned to a vehicle
  assign_person               — link person ↔ vehicle
  unassign_person             — remove person from vehicle

Service logs
  create_service_log / get_service_logs / get_service_log / update_service_log / delete_service_log
  attach_receipt
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlalchemy.orm import Session

from .models import (
    CheckStatus,
    MaintenancePerson,
    ServiceCheckResult,
    ServiceLevel,
    ServiceLog,
    Vehicle,
    VehicleAssignment,
    VehicleCheckPoint,
    VehicleFluidSpec,
    VehicleTorqueSpec,
    VehicleType,
)

logger = logging.getLogger(__name__)

VEHICLE_FILES_BASE_DIR = os.environ.get("VEHICLE_FILES_DIR", "./vehicle_files")
_MAIN_DB_PATH = os.environ.get("MAIN_DB_PATH", "./data/river_song.db")

# ---------------------------------------------------------------------------
# Vehicle type templates
# Each entry: (description, interval_miles, interval_days, expected_spec, min_value, max_value, unit)
# ---------------------------------------------------------------------------

_CP = lambda d, mi=None, dy=None, spec=None, mn=None, mx=None, unit=None: {
    "description": d, "interval_miles": mi, "interval_days": dy,
    "expected_spec": spec, "min_value": mn, "max_value": mx, "unit": unit,
}

VEHICLE_TEMPLATES: dict[str, dict] = {
    VehicleType.MOTO.value: {
        "check_points": [
            _CP("Chain tension",     mi=3750,  spec="20-30mm slack",   mn=20.0, mx=30.0, unit="mm"),
            _CP("Tire pressure",     dy=14,    spec="See sidewall",    unit="PSI"),
            _CP("Brake fluid",       dy=730,   spec="Replace every 2 years"),
            _CP("Cam chain",         mi=6000,  spec="Inspect / adjust"),
            _CP("Brake pads front",  mi=6000,  spec=">2mm remaining",  mn=2.0,  unit="mm"),
            _CP("Brake pads rear",   mi=6000,  spec=">2mm remaining",  mn=2.0,  unit="mm"),
            _CP("Lights",            dy=30,    spec="All functional"),
            _CP("Engine oil level",  mi=1000,  spec="Between min/max marks"),
        ],
        "fluid_specs": [
            {"name": "Engine Oil",  "spec": "Check owner's manual", "volume": ""},
            {"name": "Brake Fluid", "spec": "DOT 4",                "volume": ""},
        ],
    },
    VehicleType.AUTO.value: {
        "check_points": [
            _CP("Engine oil change",        mi=7500,  dy=365,  spec="Full synthetic recommended"),
            _CP("Tire pressure",            dy=30,             spec="See door jamb sticker",   unit="PSI"),
            _CP("Brake fluid",              dy=1095,           spec="Replace every 3 years"),
            _CP("Air filter",               mi=15000,          spec="Inspect / replace"),
            _CP("Transmission fluid",       mi=30000,          spec="Inspect / replace"),
            _CP("Coolant flush",            mi=50000, dy=1825, spec="Every 5 years or 50k mi"),
            _CP("Brake pads front",         mi=25000,          spec=">3mm remaining",  mn=3.0, unit="mm"),
            _CP("Brake pads rear",          mi=25000,          spec=">3mm remaining",  mn=3.0, unit="mm"),
            _CP("Wiper blades",             dy=365,            spec="Replace annually or when streaking"),
        ],
        "fluid_specs": [
            {"name": "Engine Oil",       "spec": "Full synthetic 0W-20 (check cap)", "volume": ""},
            {"name": "Coolant",          "spec": "50/50 premix",                     "volume": ""},
            {"name": "Brake Fluid",      "spec": "DOT 3 or DOT 4",                  "volume": ""},
            {"name": "Trans Fluid",      "spec": "Check owner's manual",             "volume": ""},
            {"name": "Windshield Wash",  "spec": "All-season",                       "volume": ""},
        ],
    },
    VehicleType.TRUCK.value: {
        "check_points": [
            _CP("Engine oil change",        mi=5000,  dy=180,  spec="Full synthetic recommended"),
            _CP("Tire pressure",            dy=30,             spec="See door jamb sticker",   unit="PSI"),
            _CP("Brake fluid",              dy=1095,           spec="Replace every 3 years"),
            _CP("Air filter",               mi=15000,          spec="Inspect / replace"),
            _CP("Transmission fluid",       mi=30000,          spec="Inspect / replace"),
            _CP("Transfer case fluid",      mi=30000,          spec="Inspect / replace"),
            _CP("Differential fluid",       mi=30000,          spec="Inspect / replace"),
            _CP("Coolant flush",            mi=50000, dy=1825, spec="Every 5 years or 50k mi"),
            _CP("Brake pads front",         mi=25000,          spec=">3mm remaining",  mn=3.0, unit="mm"),
            _CP("Brake pads rear",          mi=25000,          spec=">3mm remaining",  mn=3.0, unit="mm"),
            _CP("Wiper blades",             dy=365,            spec="Replace annually"),
        ],
        "fluid_specs": [
            {"name": "Engine Oil",       "spec": "Full synthetic 5W-30 (check cap)", "volume": ""},
            {"name": "Coolant",          "spec": "50/50 premix",                     "volume": ""},
            {"name": "Brake Fluid",      "spec": "DOT 3 or DOT 4",                  "volume": ""},
            {"name": "Trans Fluid",      "spec": "Check owner's manual",             "volume": ""},
            {"name": "Transfer Case",    "spec": "Check owner's manual",             "volume": ""},
            {"name": "Differential",     "spec": "Check owner's manual",             "volume": ""},
        ],
    },
    VehicleType.ATV.value: {
        "check_points": [
            _CP("Engine oil change",    mi=100,  dy=180, spec="Check owner's manual"),
            _CP("Air filter",           mi=500,          spec="Clean / replace"),
            _CP("Chain / belt",         mi=200,          spec="Inspect tension and wear"),
            _CP("Tire pressure",        dy=14,           spec="See sidewall",    unit="PSI"),
            _CP("Brake pads",           mi=2000,         spec=">2mm remaining",  mn=2.0, unit="mm"),
            _CP("Brake fluid",          dy=730,          spec="Replace every 2 years"),
            _CP("Coolant",              dy=730,          spec="Check level"),
        ],
        "fluid_specs": [
            {"name": "Engine Oil",   "spec": "Check owner's manual", "volume": ""},
            {"name": "Brake Fluid",  "spec": "DOT 4",                "volume": ""},
        ],
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid(s) -> "uuid.UUID":
    """Convert a str/UUID to uuid.UUID for Uuid(as_uuid=True) column comparisons."""
    import uuid as _u
    return s if isinstance(s, _u.UUID) else _u.UUID(str(s))


class VehicleNotFoundError(Exception):
    pass

class PersonNotFoundError(Exception):
    pass

class PermissionDeniedError(Exception):
    pass

class PersonAlreadyExistsError(Exception):
    pass

class AssignmentExistsError(Exception):
    pass

class PersonStillAssignedError(Exception):
    pass


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

def _get_vehicle(db: Session, vehicle_id: str, user_id: str) -> Vehicle:
    v = db.query(Vehicle).filter(Vehicle.id == _uid(vehicle_id)).first()
    if not v:
        raise VehicleNotFoundError(f"Vehicle '{vehicle_id}' not found.")
    if v.external_user_id != user_id:
        raise PermissionDeniedError("You do not own this vehicle.")
    return v


def _get_person(db: Session, person_id: str, owner_user_id: str) -> MaintenancePerson:
    p = db.query(MaintenancePerson).filter(MaintenancePerson.id == _uid(person_id)).first()
    if not p:
        raise PersonNotFoundError(f"Person '{person_id}' not found.")
    if p.owner_user_id != owner_user_id:
        raise PermissionDeniedError("You do not manage this person.")
    return p


# ---------------------------------------------------------------------------
# Vehicles
# ---------------------------------------------------------------------------

def get_vehicles(db: Session, user_id: str) -> list[Vehicle]:
    return (
        db.query(Vehicle)
        .filter(Vehicle.external_user_id == user_id)
        .order_by(Vehicle.year.desc(), Vehicle.make)
        .all()
    )


def create_vehicle(
    db: Session,
    user_id: str,
    make: str,
    model: str,
    year: Optional[int] = None,
    trim: str = "",
    nickname: str = "",
    vehicle_type: VehicleType = VehicleType.AUTO,
    vin: str = "",
    license_plate: str = "",
    color: str = "",
    notes: str = "",
) -> Vehicle:
    v = Vehicle(
        external_user_id=user_id,
        make=make,
        model=model,
        year=year,
        trim=trim or None,
        nickname=nickname or None,
        vehicle_type=vehicle_type,
        vin=vin or None,
        license_plate=license_plate or None,
        color=color or None,
        notes=notes or None,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    logger.info("Vehicle created: %s for user=%s", v.id, user_id)
    _seed_vehicle_defaults(db, v)
    return v


def _seed_vehicle_defaults(db: Session, vehicle: Vehicle) -> None:
    """Populate standard checkpoints and fluid specs based on vehicle type."""
    template = VEHICLE_TEMPLATES.get(vehicle.vehicle_type.value if vehicle.vehicle_type else "")
    if not template:
        return
    for i, cp in enumerate(template.get("check_points", [])):
        db.add(VehicleCheckPoint(
            vehicle_id=vehicle.id,
            description=cp["description"],
            sort_order=i,
            interval_miles=cp.get("interval_miles"),
            interval_days=cp.get("interval_days"),
            expected_spec=cp.get("expected_spec"),
            min_value=cp.get("min_value"),
            max_value=cp.get("max_value"),
            unit=cp.get("unit"),
        ))
    for fs in template.get("fluid_specs", []):
        db.add(VehicleFluidSpec(
            vehicle_id=vehicle.id,
            name=fs["name"],
            spec=fs.get("spec"),
            volume=fs.get("volume") or None,
        ))
    db.commit()
    db.refresh(vehicle)
    logger.info("Seeded defaults for vehicle %s (type=%s)", vehicle.id, vehicle.vehicle_type)


def update_vehicle(db: Session, user_id: str, vehicle_id: str, **fields) -> Vehicle:
    v = _get_vehicle(db, vehicle_id, user_id)
    for k, val in fields.items():
        if val is not None:
            setattr(v, k, val)
    db.commit()
    db.refresh(v)
    return v


def delete_vehicle(db: Session, user_id: str, vehicle_id: str) -> None:
    v = _get_vehicle(db, vehicle_id, user_id)
    db.delete(v)
    db.commit()


# ---------------------------------------------------------------------------
# Specs
# ---------------------------------------------------------------------------

def add_fluid_spec(
    db: Session, user_id: str, vehicle_id: str,
    name: str, spec: str = "", volume: str = ""
) -> VehicleFluidSpec:
    _get_vehicle(db, vehicle_id, user_id)
    f = VehicleFluidSpec(vehicle_id=vehicle_id, name=name, spec=spec or None, volume=volume or None)
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


def delete_fluid_spec(db: Session, user_id: str, spec_id: str) -> None:
    f = db.query(VehicleFluidSpec).filter(VehicleFluidSpec.id == _uid(spec_id)).first()
    if not f:
        raise NoResultFound(f"Fluid spec '{spec_id}' not found.")
    _get_vehicle(db, str(f.vehicle_id), user_id)
    db.delete(f)
    db.commit()


def add_torque_spec(
    db: Session, user_id: str, vehicle_id: str,
    name: str, ft_lb: Optional[float] = None, nm: Optional[float] = None,
) -> VehicleTorqueSpec:
    _get_vehicle(db, vehicle_id, user_id)
    t = VehicleTorqueSpec(vehicle_id=vehicle_id, name=name, ft_lb=ft_lb, nm=nm)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def delete_torque_spec(db: Session, user_id: str, spec_id: str) -> None:
    t = db.query(VehicleTorqueSpec).filter(VehicleTorqueSpec.id == _uid(spec_id)).first()
    if not t:
        raise NoResultFound(f"Torque spec '{spec_id}' not found.")
    _get_vehicle(db, str(t.vehicle_id), user_id)
    db.delete(t)
    db.commit()


def add_check_point(
    db: Session, user_id: str, vehicle_id: str,
    description: str, sort_order: int = 0,
    service_level: str = "inspect",
    interval_miles: Optional[int] = None,
    interval_days: Optional[int] = None,
    due_at_miles: Optional[int] = None,
    expected_spec: Optional[str] = None,
    volume: Optional[str] = None,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
    unit: Optional[str] = None,
    ft_lb: Optional[float] = None,
    nm: Optional[float] = None,
) -> VehicleCheckPoint:
    _get_vehicle(db, vehicle_id, user_id)
    svc = ServiceLevel.INSPECT
    try:
        svc = ServiceLevel(service_level)
    except ValueError:
        pass
    cp = VehicleCheckPoint(
        vehicle_id=vehicle_id, description=description, sort_order=sort_order,
        service_level=svc,
        interval_miles=interval_miles, interval_days=interval_days, due_at_miles=due_at_miles,
        expected_spec=expected_spec, volume=volume,
        min_value=min_value, max_value=max_value, unit=unit,
        ft_lb=ft_lb, nm=nm,
    )
    db.add(cp)
    db.commit()
    db.refresh(cp)
    return cp


def update_check_point(
    db: Session, user_id: str, point_id: str,
    description: Optional[str] = None,
    service_level: Optional[str] = None,
    interval_miles: Optional[int] = None,
    interval_days: Optional[int] = None,
    due_at_miles: Optional[int] = None,
    expected_spec: Optional[str] = None,
    volume: Optional[str] = None,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
    unit: Optional[str] = None,
    ft_lb: Optional[float] = None,
    nm: Optional[float] = None,
) -> VehicleCheckPoint:
    cp = db.query(VehicleCheckPoint).filter(VehicleCheckPoint.id == _uid(point_id)).first()
    if not cp:
        raise NoResultFound(f"Check point '{point_id}' not found.")
    _get_vehicle(db, str(cp.vehicle_id), user_id)
    if description    is not None: cp.description    = description
    if interval_miles is not None: cp.interval_miles = interval_miles
    if interval_days  is not None: cp.interval_days  = interval_days
    if due_at_miles   is not None: cp.due_at_miles   = due_at_miles
    if expected_spec  is not None: cp.expected_spec  = expected_spec
    if volume         is not None: cp.volume         = volume
    if min_value      is not None: cp.min_value      = min_value
    if max_value      is not None: cp.max_value      = max_value
    if unit           is not None: cp.unit           = unit
    if ft_lb          is not None: cp.ft_lb          = ft_lb
    if nm             is not None: cp.nm             = nm
    if service_level:
        try:
            cp.service_level = ServiceLevel(service_level)
        except ValueError:
            pass
    db.commit()
    db.refresh(cp)
    return cp


def delete_check_point(db: Session, user_id: str, point_id: str) -> None:
    cp = db.query(VehicleCheckPoint).filter(VehicleCheckPoint.id == _uid(point_id)).first()
    if not cp:
        raise NoResultFound(f"Check point '{point_id}' not found.")
    _get_vehicle(db, str(cp.vehicle_id), user_id)
    db.delete(cp)
    db.commit()


def clear_all_check_points(db: Session, user_id: str, vehicle_id: str) -> None:
    """Delete every inspection point on a vehicle (ownership-checked)."""
    v = _get_vehicle(db, vehicle_id, user_id)
    db.query(VehicleCheckPoint).filter(VehicleCheckPoint.vehicle_id == v.id).delete()
    db.commit()


# ---------------------------------------------------------------------------
# Manual PDF extraction → checkpoint intervals
# ---------------------------------------------------------------------------

def extract_text_from_pdf(file_data: bytes) -> str:
    """Extract all text from a PDF using pypdf."""
    import io
    import pypdf
    reader = pypdf.PdfReader(io.BytesIO(file_data))
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text)
    return "\n\n".join(pages)


def _infer_service_level(description: str) -> str:
    d = description.lower()
    if any(k in d for k in ("replace", "renewal", "change", "flush", "overhaul", "rebuild", "swap")):
        return "replace"
    if any(k in d for k in ("adjust", "top", "lube", "lubricate", "fill", "service", "clean", "tighten")):
        return "service"
    return "inspect"


def parse_manual_local(pdf_text: str) -> list[dict]:
    """
    Extract maintenance intervals from a vehicle owner's manual.

    Handles the three layouts found in real PDFs:

    1. Prose  — "Replace engine oil every 5,000 miles or 6 months"
    2. Table  — "Engine Oil and Filter   7,500   6" (numbers with no "every")
    3. Split  — item name on one line, interval on the next 1-3 lines

    Strategy:
      - Build a list of (line_index, canonical_name) for every line that contains
        a known service keyword.
      - For each such line, search a window of ±3 lines for interval numbers.
      - Bare numbers are interpreted as miles when they are in the plausible range
        (500–100,000) and as months when they are 1–60.  Both heuristics are
        applied only when a named unit is absent.
    """
    import re

    # ── Converters ────────────────────────────────────────────────────────────
    def to_miles(val: float, unit: str) -> int:
        return int(val * 0.621371) if "km" in unit.lower() else int(val)

    def to_days(val: float, unit: str) -> int:
        u = unit.lower()
        if "year"  in u: return int(val * 365)
        if "month" in u: return int(val * 30)
        if "week"  in u: return int(val * 7)
        return int(val)

    # ── Patterns ──────────────────────────────────────────────────────────────
    MI_UNIT  = r"(?:miles?|mi\.?|kilometers?|km)"
    DAY_UNIT = r"(?:years?|months?|weeks?|days?)"
    NUM      = r"[\d,]+(?:\.\d+)?"

    # Named mileage: "every 7,500 miles", "at 5000 km", "7,500-mile"
    RE_MI_NAMED = re.compile(
        rf"(?:(?:every|each|at|per)\s+)?({NUM})\s*[,\-]?\s*({MI_UNIT})",
        re.IGNORECASE,
    )
    # Named time: "every 6 months", "replace after 2 years", "check monthly"
    RE_DAY_NAMED = re.compile(
        rf"(?:every|each|per|after|replace\s+(?:after|every))?\s*({NUM})\s+({DAY_UNIT})"
        rf"|(?:^|\s)(monthly|annually|weekly)(?:\s|$|\.)",
        re.IGNORECASE,
    )
    ADV_DAYS = {"monthly": 30, "annually": 365, "weekly": 7}
    # "6M", "12M", "24M" — calendar column shorthand used in many Asian OEM manuals
    RE_MONTH_CODE = re.compile(r"(?<!\w)(\d{1,2})M(?!\w)", re.IGNORECASE)
    # Bare number (table column) — matched only when no unit found
    RE_BARE_NUM = re.compile(r"\b([\d,]+)\b")
    # Common service-interval month values — filter out arbitrary numbers
    VALID_MONTHS = {1, 2, 3, 4, 6, 9, 12, 18, 24, 36, 48, 60}

    # Numeric range spec: "20-30 mm", "29–33 PSI"
    # Requires a proper measurement unit — "in" alone is excluded (too ambiguous with "in the...")
    RE_RANGE = re.compile(
        r"([\d.]+)\s*(?:[-–]|to)\s*([\d.]+)\s*(mm|psi|kpa|bar|cm|°[cf]|n·?m|ft\.?\s*lb)",
        re.IGNORECASE,
    )
    # Minimum spec: "> 2 mm", "minimum 3mm", "≥ 2mm"
    RE_MIN = re.compile(
        r"(?:≥|>=|>|minimum|min\.?|at\s+least)\s*([\d.]+)\s*(mm|psi|kpa|bar|cm)",
        re.IGNORECASE,
    )
    # Standalone PSI/kPa value: "32 PSI", "220 kPa" (for tire pressure lines)
    RE_PRESSURE = re.compile(r"\b(\d{2,3})\s*(psi|kpa)\b", re.IGNORECASE)
    # N•m with Unicode bullet (U+2022) as well as middle-dot and hyphen
    RE_NM_FIXED = re.compile(r"([\d.]+)\s*(?:n[\-·•]?m\b|newton[\-·•]?m)", re.IGNORECASE)

    # ── Item keyword map — ordered most-specific first ────────────────────────
    ITEMS = [
        # Engine
        (r"engine\s+oil\s+and\s+oil\s+filter|engine\s+oil\s+(?:&|and)\s+filter", "Engine Oil Change"),
        (r"engine\s+oil|motor\s+oil|oil\s+change",                                "Engine Oil Change"),
        (r"oil\s+strainer|oil\s+screen",                                           "Oil Strainer"),
        (r"oil\s+filter",                                                           "Oil Filter"),
        (r"cabin\s+(?:air\s+)?filter",                                             "Cabin Air Filter"),
        (r"air\s+filter\s+element|air\s+cleaner\s+element",                        "Air Filter"),
        (r"air\s+filter|air\s+cleaner",                                            "Air Filter"),
        (r"fuel\s+filter",                                                          "Fuel Filter"),
        (r"spark\s+plug",                                                           "Spark Plugs"),
        (r"valve\s+(?:clearance|adjustment|lash)",                                 "Valve Clearance"),
        (r"cam\s+chain",                                                            "Cam Chain"),
        (r"throttle\s+(?:body|cable|play|system)",                                 "Throttle System"),
        # Fluids
        (r"coolant|antifreeze|radiator\s+fluid",                                   "Coolant"),
        (r"transmission\s+fluid|trans\.?\s+fluid|atf\b",                           "Transmission Fluid"),
        (r"brake\s+fluid\s+level",                                                 "Brake Fluid Level"),
        (r"brake\s+fluid",                                                          "Brake Fluid"),
        (r"power\s+steering\s+fluid",                                              "Power Steering Fluid"),
        (r"differential\s+(?:fluid|oil|gear)",                                     "Differential Fluid"),
        (r"transfer\s+case",                                                        "Transfer Case Fluid"),
        # Brakes
        (r"brake\s+(?:disc|disk|rotor)",                                           "Brake Discs"),
        (r"brake\s+pad",                                                            "Brake Pads"),
        (r"brake\s+hose",                                                           "Brake Hoses"),
        (r"brake\s+lever",                                                          "Brake Lever"),
        (r"brake\s+(?:shoe|lining)",                                               "Brake Shoes"),
        (r"front\s+and\s+rear\s+brake\s+system|brake\s+system",                   "Brake System"),
        # Drive
        (r"chain[,\s]+(?:rear\s+)?sprocket|drive\s+chain\s+and\s+sprocket",       "Drive Chain & Sprockets"),
        (r"chain\s+(?:tension|slack|lube|lubrication|oil)",                        "Chain Tension / Lube"),
        (r"drive\s+chain",                                                          "Drive Chain"),
        (r"timing\s+belt|cam(?:shaft)?\s+belt",                                    "Timing Belt"),
        (r"drive\s+belt|serpentine\s+belt|v-?belt",                               "Drive Belt"),
        # Wheels & Tires
        (r"tire\s+(?:pressure|inflation)",                                          "Tire Pressure"),
        (r"tire\s+(?:condition|wear|check)",                                        "Tire Condition"),
        (r"tire\s+rotation|rotate\s+tires?",                                        "Tire Rotation"),
        (r"wheel\s+bearing|hub\s+bearing",                                          "Wheel Bearings"),
        # Suspension & Steering
        (r"rear\s+shock\s+absorber\s+and\s+front\s+forks?|front\s+fork",          "Front Forks / Rear Shock"),
        (r"suspension\s+system|suspension",                                         "Suspension"),
        (r"shock\s+absorber|strut",                                                 "Shocks / Struts"),
        (r"steering\s+bearing",                                                     "Steering Bearings"),
        (r"steering\s+(?:system|linkage|gear)",                                    "Steering"),
        # Electrical
        (r"fuse|circuit\s+breaker",                                                 "Fuses / Circuit Breakers"),
        (r"battery",                                                                 "Battery"),
        # Clutch & Transmission
        (r"clutch",                                                                  "Clutch"),
        # Other mechanical
        (r"frame\b",                                                                 "Frame"),
        (r"axle\s+(?:boot|shaft)|cv\s+(?:boot|joint)",                            "CV / Axle Boots"),
        (r"exhaust\s+(?:system|pipe)",                                              "Exhaust System"),
        (r"wiper\s+(?:blade|insert|refill)",                                        "Wiper Blades"),
        (r"fuel\s+(?:system|injector|lines?)",                                      "Fuel System"),
        (r"headlight|tail\s*light|bulb",                                            "Lights"),
    ]
    ITEM_RE = [(re.compile(pat, re.IGNORECASE), name) for pat, name in ITEMS]

    # Lines that contain only section/header text — skip for interval extraction
    SKIP_RE = re.compile(
        r"^\s*(?:daily\s+safety|pre.?ride|before\s+(?:each|every)\s+ride"
        r"|break.?in\s+period|operating\s+your|introduction|table\s+of|chapter"
        r"|warning|caution|note\s*:|danger|severe\s+use)",
        re.IGNORECASE,
    )

    # ── Build line list ───────────────────────────────────────────────────────
    lines = [l.strip() for l in pdf_text.splitlines()]

    def identify_item(text: str) -> str | None:
        if SKIP_RE.match(text):
            return None
        for pat, name in ITEM_RE:
            if pat.search(text):
                return name
        return None

    def extract_intervals(text: str) -> tuple[int | None, int | None]:
        """Return (miles, days) from a text snippet, or (None, None)."""
        miles = days = None

        # Named mileage units
        for m in RE_MI_NAMED.finditer(text):
            raw, unit = m.group(1).replace(",", ""), m.group(2)
            v = to_miles(float(raw), unit)
            if 100 <= v <= 200_000:
                miles = v if miles is None else min(miles, v)

        # "6M" / "12M" / "24M" — OEM calendar shorthand
        for m in RE_MONTH_CODE.finditer(text):
            v = int(m.group(1)) * 30
            if v > 0:
                days = v if days is None else min(days, v)

        # Named time words ("every 6 months", "annually")
        for m in RE_DAY_NAMED.finditer(text):
            if m.group(1) and m.group(2):
                raw, unit = m.group(1).replace(",", ""), m.group(2)
                v = to_days(float(raw), unit)
                if 7 <= v <= 3650:
                    days = v if days is None else min(days, v)
            elif m.group(3):
                v = ADV_DAYS.get(m.group(3).lower(), 0)
                if v:
                    days = v if days is None else min(days, v)

        return miles, days

    def extract_spec(text: str, item_name: str = "") -> tuple[str | None, float | None, float | None, str | None]:
        """Return (expected_spec, min_val, max_val, unit)."""
        # Numeric range — validate lo < hi to avoid section-number false positives
        m = RE_RANGE.search(text)
        if m:
            lo, hi, unit = float(m.group(1)), float(m.group(2)), m.group(3).upper()
            if lo < hi:
                return f"{m.group(1)}–{m.group(2)} {unit}", lo, hi, unit

        # Minimum threshold
        m = RE_MIN.search(text)
        if m:
            val, unit = float(m.group(1)), m.group(2).upper()
            return f"≥ {m.group(1)} {unit}", val, None, unit

        # Standalone pressure value (tire pressure, brake system)
        if any(k in item_name.lower() for k in ("tire", "pressure", "brake")):
            m = RE_PRESSURE.search(text)
            if m:
                val, unit = m.group(1), m.group(2).upper()
                return f"{val} {unit}", float(val), None, unit

        # Text-based specs — item-specific patterns
        n = item_name.lower()
        if "oil" in n and "filter" not in n:
            # Oil viscosity grade: "0W-20", "SAE 5W-30", "dexos1"
            m = re.search(r"\b((?:SAE\s+)?(?:0W-20|0W-30|5W-20|5W-30|5W-40|10W-30|10W-40))\b", text, re.I)
            if m:
                return m.group(1).upper(), None, None, None
            m = re.search(r"\b(dexos\s*\d?)\b", text, re.I)
            if m:
                return m.group(1).capitalize(), None, None, None
            m = re.search(r"\b(full[\s-]synthetic|synthetic[\s-]blend)\b", text, re.I)
            if m:
                return m.group(1).title(), None, None, None

        if "brake fluid" in n:
            m = re.search(r"\b(DOT[-\s]?[3-5](?:\+|\.1)?)\b", text, re.I)
            if m:
                return m.group(1).upper(), None, None, None

        if "coolant" in n or "antifreeze" in n:
            m = re.search(r"\b(DEX-?COOL|OAT|HOAT|G\d+)\b", text, re.I)
            if m:
                return m.group(1).upper(), None, None, None
            m = re.search(r"\b(50[/\\]50|premix|pre-mix)\b", text, re.I)
            if m:
                return "50/50 Premix", None, None, None

        if "transmission" in n:
            m = re.search(r"\b(DEXRON[-\s]?(?:VI|V|IV|III|II|I|\d))\b", text, re.I)
            if m:
                return m.group(1).upper(), None, None, None
            m = re.search(r"\b(ATF\+?\d*|CVT)\b", text, re.I)
            if m:
                return m.group(1).upper(), None, None, None

        if "differential" in n or "transfer case" in n:
            m = re.search(r"\b(75W-\d+|80W-\d+|SAE\s+\d+)\b", text, re.I)
            if m:
                return m.group(1).upper(), None, None, None

        return None, None, None, None

    # Numbers that are part of a range (e.g. 32 in "32-35 PSI") — exclude from bare heuristic
    RE_IN_RANGE = re.compile(r"[\d.]+\s*[-–]\s*[\d.]+\s*(?:mm|psi|kpa|bar|in|cm)", re.IGNORECASE)

    # Viscosity grade masking ("10W-40", "5W-30") — prevent numerals being
    # mis-read as months by the bare-number heuristic
    RE_VISCOSITY = re.compile(r"\d+W-\d+", re.IGNORECASE)

    RE_DECIMAL = re.compile(r'\b\d+\.\d+\b')

    def bare_number_intervals(text: str) -> tuple[int | None, int | None]:
        """
        Heuristic for table rows with no unit labels (e.g. Item | - | 3000 | 5000 | Replace).
        Treats the first number 500-150,000 as miles.
        Treats a bare number only if it is a recognised service-month value (VALID_MONTHS).
        Masks spec ranges, viscosity grades, and decimals to avoid false positives.
        """
        miles = days = None
        masked = RE_IN_RANGE.sub("XXXX", text)
        masked = RE_VISCOSITY.sub("XXXX", masked)
        masked = RE_DECIMAL.sub("XXXX", masked)   # prevent "7.3" → "7" and "3" being matched
        for m in RE_BARE_NUM.finditer(masked):
            raw = m.group(1).replace(",", "")
            if not raw.isdigit():
                continue
            v = int(raw)
            if 500 <= v <= 150_000 and miles is None:
                miles = v
            elif v in VALID_MONTHS and days is None:
                days = v * 30  # months → days
        return miles, days

    # ── Scan with sliding window ──────────────────────────────────────────────
    results: dict[str, dict] = {}

    for i, line in enumerate(lines):
        item_name = identify_item(line)
        if not item_name:
            continue

        entry = results.setdefault(item_name, {
            "description":    item_name,
            "service_level":  _infer_service_level(item_name),
            "interval_miles": None,
            "interval_days":  None,
            "due_at_miles":   None,
            "expected_spec":  None,
            "volume":         None,
            "min_value":      None,
            "max_value":      None,
            "unit":           None,
            "ft_lb":          None,
            "nm":             None,
        })

        # Pass 1: current line only (handles prose + table format).
        mi, dy = extract_intervals(line)
        spec, mn, mx, unit = extract_spec(line, item_name)

        # Pass 2: if this line has a keyword but no interval, peek at the next
        # line — this handles split-format where the interval appears below the name.
        if mi is None and dy is None and i + 1 < len(lines):
            next_line = lines[i + 1]
            mi2, dy2 = extract_intervals(next_line)
            if mi2 or dy2:
                mi, dy = mi2, dy2
                if spec is None:
                    spec, mn, mx, unit = extract_spec(next_line, item_name)

        # Pass 3: bare-number heuristic for table rows (no unit labels).
        # Run for miles regardless of whether days was already found (e.g. "6M 3000 5000").
        # Run for days only when both are still missing.
        if mi is None or dy is None:
            mi_b, dy_b = bare_number_intervals(line)
            if mi_b and mi is None: mi = mi_b
            if dy_b and dy is None: dy = dy_b

        # Commit to entry (don't overwrite already-found values)
        if mi  and entry["interval_miles"] is None: entry["interval_miles"] = mi
        if dy  and entry["interval_days"]  is None: entry["interval_days"]  = dy
        if spec and entry["expected_spec"] is None:
            entry["expected_spec"] = spec
            entry["min_value"]     = mn
            entry["max_value"]     = mx
            entry["unit"]          = unit

        # Infer service level from Remarks column keywords on the same line
        # (e.g. "Replace" → replace; "Lubricate" → service)
        current_level = entry["service_level"]
        if current_level == "inspect":
            if re.search(r"\breplace\b", line, re.IGNORECASE):
                entry["service_level"] = "replace"
            elif re.search(r"\b(?:lubricate|lube|adjust|clean|service|top.?off|fill)\b", line, re.IGNORECASE):
                entry["service_level"] = "service"

    check_points = [
        v for v in results.values()
        if v["interval_miles"] or v["interval_days"] or v["expected_spec"]
    ]

    # ── Fluid specs ───────────────────────────────────────────────────────────
    # Extract fluid name, type/spec, and fill capacity.
    CAP_UNIT = r"(?:quarts?|qt\.?|liters?|litres?|L(?:\b)|gallons?|gal\.?|fl\.?\s*oz)"
    RE_CAP   = re.compile(rf"\b([\d.]+)\s*({CAP_UNIT})\b", re.IGNORECASE)

    FLUID_KEYWORDS = [
        (r"engine\s+oil|motor\s+oil",                 "Engine Oil"),
        (r"engine\s+coolant|radiator\s+coolant|antifreeze", "Engine Coolant"),
        (r"brake\s+fluid",                             "Brake Fluid"),
        (r"transmission\s+fluid|auto(?:matic)?\s+trans(?:mission)?\s+fluid|atf\b", "Transmission Fluid"),
        (r"transfer\s+case\s+fluid",                   "Transfer Case Fluid"),
        (r"front\s+differential|front\s+axle\s+fluid", "Front Differential Fluid"),
        (r"rear\s+differential|rear\s+axle\s+fluid",   "Rear Differential Fluid"),
        (r"power\s+steering\s+fluid",                  "Power Steering Fluid"),
        (r"windshield\s+wash|washer\s+fluid",           "Windshield Washer Fluid"),
    ]
    FLUID_RE = [(re.compile(p, re.IGNORECASE), n) for p, n in FLUID_KEYWORDS]

    fluid_results: dict[str, dict] = {}
    for i, line in enumerate(lines):
        for pat, name in FLUID_RE:
            if not pat.search(line):
                continue
            entry = fluid_results.setdefault(name, {"name": name, "spec": None, "volume": None})
            window = line + (" " + lines[i + 1] if i + 1 < len(lines) else "")
            # Spec
            if entry["spec"] is None:
                spec, *_ = extract_spec(window, name.lower())
                if spec:
                    entry["spec"] = spec
            # Capacity
            if entry["volume"] is None:
                m = RE_CAP.search(window)
                if m:
                    entry["volume"] = f"{m.group(1)} {m.group(2).rstrip('.')}".strip()
            break

    # ── Torque specs ──────────────────────────────────────────────────────────
    RE_FT_LB = re.compile(r"([\d.]+)\s*(?:ft[-·•]?lbs?\.?|lb[-·•]?ft\.?|ft\s*lbs?)", re.IGNORECASE)
    RE_NM    = re.compile(r"([\d.]+)\s*(?:n[-·•]?m\b|newton[-·•]?m)", re.IGNORECASE)

    TORQUE_KEYWORDS = [
        (r"oil\s+drain\s+(?:plug|bolt)|drain\s+plug|drain\s+bolt", "Oil Drain Plug"),
        (r"oil\s+filter\s+cover|filter\s+cover\s+nut",    "Oil Filter Cover"),
        (r"oil\s+filter\s+(?:housing|adapter)",            "Oil Filter Housing"),
        (r"spark\s+plug",                                  "Spark Plugs"),
        (r"lug\s+(?:nut|bolt)|wheel\s+(?:nut|bolt|stud)", "Wheel Lug Nuts"),
        (r"axle\s+nut|hub\s+nut|spindle\s+nut",           "Axle Nut"),
        (r"caliper\s+(?:bolt|pin|bracket)",                "Brake Caliper Bolt"),
        (r"rotor\s+bolt|brake\s+disc\s+bolt",              "Brake Rotor Bolt"),
        (r"cylinder\s+head\s+bolt",                        "Cylinder Head Bolt"),
        (r"crankshaft\s+pulley|harmonic\s+balancer",       "Crankshaft Pulley Bolt"),
        (r"camshaft\s+(?:cap|bearing|cover)",              "Camshaft Cap Bolt"),
        (r"exhaust\s+manifold\s+(?:bolt|nut|stud)",        "Exhaust Manifold Bolt"),
        (r"intake\s+manifold\s+bolt",                      "Intake Manifold Bolt"),
        (r"flywheel\s+bolt|flex\s+plate",                  "Flywheel Bolt"),
        (r"control\s+arm\s+bolt|lower\s+arm\s+bolt",      "Control Arm Bolt"),
        (r"tie\s+rod\s+(?:end\s+)?nut",                   "Tie Rod End Nut"),
        (r"sway\s+bar|stabilizer\s+(?:bar|link)",         "Sway Bar Link"),
        (r"strut\s+(?:mount|nut|bolt)|shock\s+mount",     "Strut Mount Nut"),
        (r"engine\s+mount\s+bolt|motor\s+mount",          "Engine Mount Bolt"),
        (r"transmission\s+mount",                          "Transmission Mount Bolt"),
        (r"battery\s+terminal|battery\s+clamp",           "Battery Terminal"),
    ]
    TORQUE_RE = [(re.compile(p, re.IGNORECASE), n) for p, n in TORQUE_KEYWORDS]

    RE_TIGHTENING = re.compile(r"tightening\s+torque\s*:", re.IGNORECASE)

    torque_results: dict[str, dict] = {}
    for idx_t, line in enumerate(lines):
        ft_m = RE_FT_LB.search(line)
        nm_m = RE_NM.search(line)

        # "Tightening Torque: X ft-lb (Y N•m)" — look back up to 6 lines
        # for the component name this torque belongs to
        if (ft_m or nm_m) and RE_TIGHTENING.search(line):
            for back in range(1, 7):
                prev = lines[idx_t - back] if idx_t - back >= 0 else ""
                for pat, name in TORQUE_RE:
                    if pat.search(prev):
                        entry = torque_results.setdefault(name, {"name": name, "ft_lb": None, "nm": None})
                        if ft_m and entry["ft_lb"] is None:
                            entry["ft_lb"] = float(ft_m.group(1))
                        if nm_m and entry["nm"] is None:
                            entry["nm"] = float(nm_m.group(1))
                        break
                else:
                    continue
                break

        if not (ft_m or nm_m):
            continue
        for pat, name in TORQUE_RE:
            if pat.search(line):
                entry = torque_results.setdefault(name, {"name": name, "ft_lb": None, "nm": None})
                if ft_m and entry["ft_lb"] is None:
                    entry["ft_lb"] = float(ft_m.group(1))
                if nm_m and entry["nm"] is None:
                    entry["nm"] = float(nm_m.group(1))
                break

    # ── Merge torque specs INTO matching checkpoints ──────────────────────
    TORQUE_TO_CP = {
        "oil drain plug":     "engine oil change",
        "oil drain bolt":     "engine oil change",
        "drain plug":         "engine oil change",
        "drain bolt":         "engine oil change",
        "oil filter cover":   "engine oil change",
        "spark plug":         "spark plugs",
        "spark plugs":        "spark plugs",
        "wheel lug nut":      "tire rotation",
        "lug nut":            "tire rotation",
        "wheel lug nuts":     "tire rotation",
        "oil filter housing": "engine oil change",
    }

    cp_by_lower = {v["description"].lower(): v for v in check_points}

    for t in list(torque_results.values()):
        name_l = t["name"].lower()
        target_key = TORQUE_TO_CP.get(name_l) or name_l
        if target_key in cp_by_lower:
            cp_by_lower[target_key]["ft_lb"] = t.get("ft_lb")
            cp_by_lower[target_key]["nm"]    = t.get("nm")
        else:
            check_points.append({
                "description":    t["name"],
                "service_level":  "service",
                "interval_miles": None,
                "interval_days":  None,
                "due_at_miles":   None,
                "expected_spec":  None,
                "volume":         None,
                "min_value":      None,
                "max_value":      None,
                "unit":           None,
                "ft_lb":          t.get("ft_lb"),
                "nm":             t.get("nm"),
            })

    # ── Merge fluid specs INTO matching checkpoints ────────────────────────
    FLUID_TO_CP = {
        "engine oil":                   "engine oil change",
        "motor oil":                    "engine oil change",
        "engine coolant":               "coolant",
        "coolant":                      "coolant",
        "antifreeze":                   "coolant",
        "brake fluid":                  "brake fluid",
        "transmission fluid":           "transmission fluid",
        "automatic transmission fluid": "transmission fluid",
        "transfer case fluid":          "transfer case fluid",
        "front differential fluid":     "differential fluid",
        "rear differential fluid":      "differential fluid",
        "power steering fluid":         "power steering fluid",
        "windshield washer fluid":      "wiper blades",
    }

    for f in list(fluid_results.values()):
        name_l = f["name"].lower()
        target_key = FLUID_TO_CP.get(name_l) or name_l
        if target_key in cp_by_lower:
            cp = cp_by_lower[target_key]
            if f.get("spec") and not cp.get("expected_spec"):
                spec = f["spec"]
                if f.get("volume"):
                    spec = f"{spec} ({f['volume']})"
                cp["expected_spec"] = spec
            if f.get("volume") and not cp.get("volume"):
                cp["volume"] = f["volume"]

    return [v for v in check_points if v.get("interval_miles") or v.get("interval_days")
            or v.get("due_at_miles") or v.get("expected_spec") or v.get("ft_lb")]


def parse_manual_with_ollama(pdf_text: str, ollama_url: str, model: str) -> list[dict]:
    """
    Optional: use a locally-running Ollama model for anything the regex missed.
    Only called if Ollama is configured and regex returned fewer than 3 items.
    """
    import urllib.request
    import urllib.error

    prompt = (
        "Extract vehicle maintenance intervals from the text below. "
        "Return a JSON array only — no explanation, no markdown. "
        "Each object: {description, interval_miles, interval_days, expected_spec, min_value, max_value, unit}. "
        "Use null for unknown fields. Only include items with a clear interval.\n\n"
        + pdf_text[:40000]
    )

    body = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode()
    req  = urllib.request.Request(
        f"{ollama_url}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    raw = data.get("response", "").strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].lstrip("json").strip()
    return json.loads(raw)


def parse_manual(pdf_text: str, ollama_url: str | None = None, ollama_model: str = "mistral") -> list[dict]:
    """
    Parse a vehicle owner's manual into a flat list of unified checkpoint dicts.
    Each dict has: description, service_level, interval_miles, interval_days,
    due_at_miles, expected_spec, volume, min_value, max_value, unit, ft_lb, nm.
    1. Local regex (fast, offline, zero cost) — always runs.
    2. Ollama fallback if < 3 items found and Ollama configured.
    """
    items = parse_manual_local(pdf_text)
    logger.info("Regex extractor: %d unified checkpoint items", len(items))

    if len(items) < 3 and ollama_url:
        try:
            llm_items = parse_manual_with_ollama(pdf_text, ollama_url, ollama_model)
            existing = {i["description"].lower() for i in items}
            for item in llm_items:
                if item.get("description", "").lower() not in existing:
                    item.setdefault("service_level", _infer_service_level(item.get("description", "")))
                    items.append(item)
            logger.info("After Ollama merge: %d items", len(items))
        except Exception as e:
            logger.warning("Ollama fallback failed (regex results kept): %s", e)

    return items


def apply_manual_intervals(
    db: Session, user_id: str, vehicle_id: str, items: list[dict]
) -> dict:
    """
    Upsert unified checkpoint rows extracted from an owner's manual.
    Matches by description (case-insensitive). Updates existing rows in place;
    creates new rows for unmatched items. Nothing is deleted.
    """
    v = _get_vehicle(db, vehicle_id, user_id)
    existing = {cp.description.lower(): cp for cp in v.check_points}
    updated = created = 0

    for item in items:
        desc = (item.get("description") or "").strip()
        if not desc:
            continue
        cp = existing.get(desc.lower())
        if cp:
            if item.get("interval_miles") is not None: cp.interval_miles = item["interval_miles"]
            if item.get("interval_days")  is not None: cp.interval_days  = item["interval_days"]
            if item.get("due_at_miles")   is not None: cp.due_at_miles   = item["due_at_miles"]
            if item.get("expected_spec")  is not None: cp.expected_spec  = item["expected_spec"]
            if item.get("volume")         is not None: cp.volume         = item["volume"]
            if item.get("min_value")      is not None: cp.min_value      = item["min_value"]
            if item.get("max_value")      is not None: cp.max_value      = item["max_value"]
            if item.get("unit")           is not None: cp.unit           = item["unit"]
            if item.get("ft_lb")          is not None: cp.ft_lb          = item["ft_lb"]
            if item.get("nm")             is not None: cp.nm             = item["nm"]
            if item.get("service_level"):
                try:
                    cp.service_level = ServiceLevel(item["service_level"])
                except ValueError:
                    pass
            updated += 1
        else:
            svc_level = ServiceLevel.INSPECT
            try:
                svc_level = ServiceLevel(item.get("service_level", "inspect"))
            except ValueError:
                pass
            db.add(VehicleCheckPoint(
                vehicle_id=v.id,
                description=desc,
                sort_order=len(existing) + created,
                service_level=svc_level,
                interval_miles=item.get("interval_miles"),
                interval_days=item.get("interval_days"),
                due_at_miles=item.get("due_at_miles"),
                expected_spec=item.get("expected_spec"),
                volume=item.get("volume"),
                min_value=item.get("min_value"),
                max_value=item.get("max_value"),
                unit=item.get("unit"),
                ft_lb=item.get("ft_lb"),
                nm=item.get("nm"),
            ))
            created += 1

    db.commit()
    db.refresh(v)
    return {"updated": updated, "created": created, "total": len(items)}


# ---------------------------------------------------------------------------
# People roster
# ---------------------------------------------------------------------------

def lookup_app_user_by_email(email: str) -> Optional[dict]:
    """
    Check the main river_song.db for an approved user with the given email.
    Returns dict with id, email, display_name or None.
    """
    try:
        conn = sqlite3.connect(_MAIN_DB_PATH)
        row = conn.execute(
            "SELECT id, email, display_name, is_approved FROM users WHERE email=? COLLATE NOCASE",
            (email,),
        ).fetchone()
        conn.close()
        if row is None:
            return None
        return {"id": row[0], "email": row[1], "display_name": row[2], "is_approved": bool(row[3])}
    except Exception as exc:
        logger.warning("Could not query main DB for user lookup: %s", exc)
        return None


def list_people(db: Session, owner_user_id: str) -> list[MaintenancePerson]:
    return (
        db.query(MaintenancePerson)
        .filter(MaintenancePerson.owner_user_id == owner_user_id)
        .order_by(MaintenancePerson.display_name, MaintenancePerson.email)
        .all()
    )


def add_person(db: Session, owner_user_id: str, email: str) -> MaintenancePerson:
    """
    Add an approved app user (by email) to the owner's maintenance roster.
    Raises ValueError if user not found or not approved.
    Raises PersonAlreadyExistsError if already on the roster.
    """
    app_user = lookup_app_user_by_email(email)
    if not app_user:
        raise ValueError(f"No app user found with email '{email}'. They must accept an invitation first.")
    if not app_user["is_approved"]:
        raise ValueError(f"'{email}' has not been approved yet.")

    existing = (
        db.query(MaintenancePerson)
        .filter(
            MaintenancePerson.owner_user_id == owner_user_id,
            MaintenancePerson.external_user_id == app_user["id"],
        )
        .first()
    )
    if existing:
        raise PersonAlreadyExistsError(f"'{email}' is already on your roster.")

    p = MaintenancePerson(
        owner_user_id=owner_user_id,
        external_user_id=app_user["id"],
        email=app_user["email"],
        display_name=app_user["display_name"] or email.split("@")[0],
    )
    db.add(p)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise PersonAlreadyExistsError(f"'{email}' is already on your roster.")
    db.refresh(p)
    return p


def remove_person(db: Session, owner_user_id: str, person_id: str) -> None:
    """Remove person from roster. Raises PersonStillAssignedError if still assigned to vehicles."""
    p = _get_person(db, person_id, owner_user_id)
    active = db.query(VehicleAssignment).filter(VehicleAssignment.person_id == p.id).count()
    if active > 0:
        raise PersonStillAssignedError(
            f"{p.display_name or p.email} is still assigned to {active} vehicle(s). "
            "Unassign them first or use force delete."
        )
    db.delete(p)
    db.commit()


def force_remove_person(db: Session, owner_user_id: str, person_id: str) -> None:
    """Unassign from all vehicles then delete. Service logs keep the name via stored display_name."""
    p = _get_person(db, person_id, owner_user_id)
    db.query(VehicleAssignment).filter(VehicleAssignment.person_id == p.id).delete()
    db.delete(p)
    db.commit()


# ---------------------------------------------------------------------------
# Vehicle assignments
# ---------------------------------------------------------------------------

def get_assignments_for_vehicle(
    db: Session, owner_user_id: str, vehicle_id: str
) -> list[VehicleAssignment]:
    _get_vehicle(db, vehicle_id, owner_user_id)
    return (
        db.query(VehicleAssignment)
        .filter(VehicleAssignment.vehicle_id == vehicle_id)
        .all()
    )


def assign_person(
    db: Session, owner_user_id: str, vehicle_id: str, person_id: str
) -> VehicleAssignment:
    _get_vehicle(db, vehicle_id, owner_user_id)
    _get_person(db, person_id, owner_user_id)

    existing = (
        db.query(VehicleAssignment)
        .filter(
            VehicleAssignment.vehicle_id == vehicle_id,
            VehicleAssignment.person_id == person_id,
        )
        .first()
    )
    if existing:
        raise AssignmentExistsError("This person is already assigned to that vehicle.")

    a = VehicleAssignment(vehicle_id=vehicle_id, person_id=person_id)
    db.add(a)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AssignmentExistsError("This person is already assigned to that vehicle.")
    db.refresh(a)
    return a


def unassign_person(
    db: Session, owner_user_id: str, vehicle_id: str, person_id: str
) -> None:
    _get_vehicle(db, vehicle_id, owner_user_id)
    deleted = (
        db.query(VehicleAssignment)
        .filter(
            VehicleAssignment.vehicle_id == vehicle_id,
            VehicleAssignment.person_id == person_id,
        )
        .delete()
    )
    if not deleted:
        raise NoResultFound("Assignment not found.")
    db.commit()


# ---------------------------------------------------------------------------
# Service logs
# ---------------------------------------------------------------------------

def create_service_log(
    db: Session,
    user_id: str,
    vehicle_id: str,
    service_date: datetime,
    odometer: Optional[int] = None,
    is_pro_service: bool = False,
    service_center: Optional[str] = None,
    service_type: Optional[str] = None,
    cost: Optional[float] = None,
    notes: str = "",
    performed_by_id: Optional[str] = None,
    check_results: Optional[list[dict]] = None,
) -> ServiceLog:
    _get_vehicle(db, vehicle_id, user_id)

    performed_by_uuid = None
    if performed_by_id:
        p = db.query(MaintenancePerson).filter(MaintenancePerson.id == _uid(performed_by_id)).first()
        if not p or p.owner_user_id != user_id:
            raise ValueError("Performer not found or not on your roster.")
        performed_by_uuid = p.id

    log = ServiceLog(
        vehicle_id=vehicle_id,
        performed_by_id=performed_by_uuid,
        service_date=service_date,
        service_type=service_type or None,
        odometer=odometer,
        is_pro_service=is_pro_service,
        service_center=service_center if is_pro_service else None,
        cost=Decimal(str(cost)) if cost is not None else None,
        notes=notes or None,
    )
    db.add(log)
    db.flush()

    for cr in (check_results or []):
        raw_status = cr.get("status")
        status_enum = None
        if raw_status in ("pass", "warn", "fail"):
            status_enum = CheckStatus(raw_status)
        elif raw_status is None:
            # Auto-calculate from actual_value and checkpoint min/max if linked
            cp_id = cr.get("check_point_id")
            actual = cr.get("actual_value")
            if cp_id and actual:
                cp = db.query(VehicleCheckPoint).filter(VehicleCheckPoint.id == _uid(cp_id)).first()
                if cp and cp.min_value is not None:
                    try:
                        num = float(actual)
                        if cp.max_value is not None:
                            if cp.min_value <= num <= cp.max_value:
                                status_enum = CheckStatus.PASS
                            elif num < cp.min_value * 0.9 or num > cp.max_value * 1.1:
                                status_enum = CheckStatus.FAIL
                            else:
                                status_enum = CheckStatus.WARN
                        else:
                            # Only min_value — it's a "must be at least X" spec
                            status_enum = CheckStatus.PASS if num >= cp.min_value else CheckStatus.FAIL
                    except (TypeError, ValueError):
                        pass

        db.add(ServiceCheckResult(
            log_id=log.id,
            check_point_id=cr.get("check_point_id") or None,
            description=cr["description"],
            actual_value=cr.get("actual_value"),
            status=status_enum,
            passed=cr.get("passed", True) if status_enum is None else (status_enum == CheckStatus.PASS),
        ))

    db.flush()

    # ── Update checkpoint tracking fields after service ───────────────────────
    # For every completed check result linked to a checkpoint, update
    # last_service_odometer / last_service_date / due_at_miles.
    if odometer or service_date:
        for cr in log.check_results:
            if not cr.check_point_id:
                continue
            # Only update if the item was checked (not failed/skipped)
            if cr.status == CheckStatus.FAIL:
                continue
            cp = db.query(VehicleCheckPoint).filter(
                VehicleCheckPoint.id == cr.check_point_id
            ).first()
            if not cp:
                continue
            if odometer:
                cp.last_service_odometer = odometer
                # Recalculate next due mileage for repeating items
                if cp.interval_miles:
                    cp.due_at_miles = odometer + cp.interval_miles
                elif cp.due_at_miles and cp.due_at_miles <= odometer:
                    # One-time milestone completed — clear it
                    cp.due_at_miles = None
            if service_date:
                cp.last_service_date = service_date

    db.commit()
    db.refresh(log)
    return log


def get_service_logs(db: Session, user_id: str, vehicle_id: str) -> list[ServiceLog]:
    _get_vehicle(db, vehicle_id, user_id)
    return (
        db.query(ServiceLog)
        .filter(ServiceLog.vehicle_id == vehicle_id)
        .order_by(ServiceLog.service_date.desc())
        .all()
    )


def get_service_log(db: Session, user_id: str, log_id: str) -> ServiceLog:
    log = db.query(ServiceLog).filter(ServiceLog.id == _uid(log_id)).first()
    if not log:
        raise NoResultFound(f"Service log '{log_id}' not found.")
    _get_vehicle(db, str(log.vehicle_id), user_id)
    return log


def update_service_log(db: Session, user_id: str, log_id: str, **fields) -> ServiceLog:
    log = get_service_log(db, user_id, log_id)
    numeric = {"cost"}
    for k, v in fields.items():
        if v is None:
            continue
        if k in numeric:
            v = Decimal(str(v))
        setattr(log, k, v)
    db.commit()
    db.refresh(log)
    return log


def delete_service_log(db: Session, user_id: str, log_id: str) -> None:
    log = get_service_log(db, user_id, log_id)
    db.delete(log)
    db.commit()


def attach_receipt(
    db: Session, user_id: str, log_id: str,
    file_data: bytes, filename: str,
) -> ServiceLog:
    log = get_service_log(db, user_id, log_id)
    vehicle_dir = os.path.join(VEHICLE_FILES_BASE_DIR, f"vehicle_{log.vehicle_id}", "receipts")
    os.makedirs(vehicle_dir, exist_ok=True)
    safe_name = os.path.basename(filename).replace("..", "")
    if not safe_name:
        safe_name = "receipt"
    filepath = os.path.join(vehicle_dir, safe_name)
    # Ensure the resolved path stays within vehicle_dir (path traversal guard)
    if not os.path.abspath(filepath).startswith(os.path.abspath(vehicle_dir)):
        raise ValueError("Invalid filename.")
    with open(filepath, "wb") as f:
        f.write(file_data)
    log.receipt_path = filepath
    db.commit()
    db.refresh(log)
    return log
