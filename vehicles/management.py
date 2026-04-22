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

import logging
import os
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlalchemy.orm import Session

from .models import (
    MaintenancePerson,
    ServiceCheckResult,
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
_MAIN_DB_PATH = os.environ.get("MAIN_DB_PATH", "./river_song.db")


def _now() -> datetime:
    return datetime.now(timezone.utc)


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
    v = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not v:
        raise VehicleNotFoundError(f"Vehicle '{vehicle_id}' not found.")
    if v.external_user_id != user_id:
        raise PermissionDeniedError("You do not own this vehicle.")
    return v


def _get_person(db: Session, person_id: str, owner_user_id: str) -> MaintenancePerson:
    p = db.query(MaintenancePerson).filter(MaintenancePerson.id == person_id).first()
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
    return v


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
    f = db.query(VehicleFluidSpec).filter(VehicleFluidSpec.id == spec_id).first()
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
    t = db.query(VehicleTorqueSpec).filter(VehicleTorqueSpec.id == spec_id).first()
    if not t:
        raise NoResultFound(f"Torque spec '{spec_id}' not found.")
    _get_vehicle(db, str(t.vehicle_id), user_id)
    db.delete(t)
    db.commit()


def add_check_point(
    db: Session, user_id: str, vehicle_id: str,
    description: str, sort_order: int = 0,
) -> VehicleCheckPoint:
    _get_vehicle(db, vehicle_id, user_id)
    cp = VehicleCheckPoint(vehicle_id=vehicle_id, description=description, sort_order=sort_order)
    db.add(cp)
    db.commit()
    db.refresh(cp)
    return cp


def delete_check_point(db: Session, user_id: str, point_id: str) -> None:
    cp = db.query(VehicleCheckPoint).filter(VehicleCheckPoint.id == point_id).first()
    if not cp:
        raise NoResultFound(f"Check point '{point_id}' not found.")
    _get_vehicle(db, str(cp.vehicle_id), user_id)
    db.delete(cp)
    db.commit()


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
        p = db.query(MaintenancePerson).filter(MaintenancePerson.id == performed_by_id).first()
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
        db.add(ServiceCheckResult(
            log_id=log.id,
            description=cr["description"],
            passed=cr.get("passed", True),
        ))

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
    log = db.query(ServiceLog).filter(ServiceLog.id == log_id).first()
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
    safe_name = os.path.basename(filename)
    filepath  = os.path.join(vehicle_dir, safe_name)
    with open(filepath, "wb") as f:
        f.write(file_data)
    log.receipt_path = filepath
    db.commit()
    db.refresh(log)
    return log
