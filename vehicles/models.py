from typing import Optional, Any
"""
vehicles/models.py

SQLAlchemy models for the Maintenance Pulse vehicle tracker.

Schema
------
Vehicle             — a user's vehicle (private per user)
VehicleCheckPoint   — unified inspection/maintenance/torque item (the single source of truth)
MaintenancePerson   — a person added to a garage owner's roster
VehicleAssignment   — many-to-many: MaintenancePerson ↔ Vehicle
ServiceLog          — a maintenance event
ServiceCheckResult  — per-item result with actual measurement

VehicleFluidSpec and VehicleTorqueSpec are retained in the DB for migration
compatibility but are no longer surfaced in the UI — their data lives in
VehicleCheckPoint.expected_spec / volume / ft_lb / nm.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import (  # type: ignore
    Boolean,
    Column, mapped_column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    JSON,
)
from sqlalchemy.orm import declarative_base, Mapped, mapped_column, relationship

Base = declarative_base()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class VehicleType(PyEnum):
    AUTO  = "auto"
    MOTO  = "moto"
    TRUCK = "truck"
    ATV   = "atv"
    OTHER = "other"


class ServiceLevel(PyEnum):
    INSPECT = "inspect"   # visual / tactile check — no parts changed
    SERVICE = "service"   # fluid top-off, adjustment, lubrication
    REPLACE = "replace"   # component replacement or full flush


class CheckStatus(PyEnum):
    # amazonq-ignore-next-line
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"


# ---------------------------------------------------------------------------
# Vehicle
# ---------------------------------------------------------------------------

class Vehicle(Base):  # type: ignore
    __tablename__ = "vehicles"

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    make: Mapped[str] = mapped_column(String,  nullable=False)
    model: Mapped[str] = mapped_column(String,  nullable=False)
    trim: Mapped[Optional[str]] = mapped_column(String,  nullable=True)
    nickname: Mapped[Optional[str]] = mapped_column(String,  nullable=True)
    vehicle_type: Mapped[VehicleType] = mapped_column(Enum(VehicleType), default=VehicleType.AUTO, nullable=False)
    vin: Mapped[Optional[str]] = mapped_column(String,  nullable=True)
    license_plate: Mapped[Optional[str]] = mapped_column(String,  nullable=True)
    color: Mapped[Optional[str]] = mapped_column(String,  nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text,    nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    check_points = relationship("VehicleCheckPoint", back_populates="vehicle", cascade="all, delete-orphan")
    service_logs = relationship("ServiceLog",        back_populates="vehicle", cascade="all, delete-orphan")
    assignments  = relationship("VehicleAssignment", back_populates="vehicle", cascade="all, delete-orphan")
    # Legacy — kept for DB compat, not surfaced in UI
    fluid_specs  = relationship("VehicleFluidSpec",  back_populates="vehicle", cascade="all, delete-orphan")
    torque_specs = relationship("VehicleTorqueSpec", back_populates="vehicle", cascade="all, delete-orphan")
    parts        = relationship("VehiclePart",       back_populates="vehicle", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Unified checkpoint — one row per service/inspection task
# ---------------------------------------------------------------------------

class VehicleCheckPoint(Base):  # type: ignore
    """
    A single maintenance or inspection line item.

    Interval fields
    ---------------
    interval_miles  — repeating mileage interval (e.g. 5000 for oil change)
    interval_days   — repeating time interval (e.g. 365 for annual)
    due_at_miles    — explicit next due odometer reading.
                      For milestones: set once (e.g. 600 mi break-in).
                      For repeating items: recalculated after each service
                      as last_service_odometer + interval_miles.

    Specification fields
    --------------------
    expected_spec   — OEM spec string (e.g. "SAE 0W-20", "25-35 mm slack")
    volume          — fluid capacity (e.g. "4.2 qt" / "4.0 L")
    min_value       — lower bound for numeric auto-pass/warn/fail
    max_value       — upper bound
    unit            — measurement unit (e.g. "mm", "PSI")

    Torque fields
    -------------
    ft_lb / nm      — torque spec for this task's fastener (e.g. drain plug)

    Tracking fields
    ---------------
    last_service_odometer — odometer when this item was last completed
    last_service_date     — date when last completed
    service_level         — inspect / service / replace
    """
    __tablename__ = "vehicle_check_points"

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    service_level: Mapped[ServiceLevel] = mapped_column(Enum(ServiceLevel), default=ServiceLevel.INSPECT, nullable=False)

    # When
    interval_miles: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    interval_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    due_at_miles: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # What spec
    expected_spec: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    volume: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    min_value: Mapped[Optional[float]] = mapped_column(Float,  nullable=True)
    max_value: Mapped[Optional[float]] = mapped_column(Float,  nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Torque (for this task's fastener)
    ft_lb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    nm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Last completed
    last_service_odometer: Mapped[Optional[int]] = mapped_column(Integer,  nullable=True)
    last_service_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    vehicle       = relationship("Vehicle", back_populates="check_points")
    check_results = relationship("ServiceCheckResult", back_populates="check_point")
    parts         = relationship("VehiclePart", back_populates="check_point", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Vehicle Parts
# ---------------------------------------------------------------------------

class VehiclePart(Base):  # type: ignore
    """
    OEM parts and alternatives for a given checkpoint.
    """
    __tablename__ = "vehicle_parts"

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    checkpoint_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("vehicle_check_points.id"), nullable=False)
    part_name: Mapped[str] = mapped_column(String, nullable=False)
    oem_part_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    oem_specs: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    alternatives: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True, default=[])
    source: Mapped[Optional[str]] = mapped_column(String, nullable=True)# "manual", "user_added", "ai_lookup"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    vehicle     = relationship("Vehicle", back_populates="parts")
    check_point = relationship("VehicleCheckPoint", back_populates="parts")


# ---------------------------------------------------------------------------
# Legacy spec tables — kept for DB compat, not used in UI
# ---------------------------------------------------------------------------

class VehicleFluidSpec(Base):  # type: ignore
    __tablename__ = "vehicle_fluid_specs"
    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    spec: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    volume: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    vehicle    = relationship("Vehicle", back_populates="fluid_specs")


class VehicleTorqueSpec(Base):  # type: ignore
    __tablename__ = "vehicle_torque_specs"
    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    ft_lb: Mapped[Optional[float]] = mapped_column(Float,  nullable=True)
    nm: Mapped[Optional[float]] = mapped_column(Float,  nullable=True)
    vehicle    = relationship("Vehicle", back_populates="torque_specs")


# ---------------------------------------------------------------------------
# People roster
# ---------------------------------------------------------------------------

class MaintenancePerson(Base):  # type: ignore
    __tablename__ = "maint_persons"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "external_user_id", name="uq_person_per_owner"),
    )

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    external_user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    assignments  = relationship("VehicleAssignment", back_populates="person", cascade="all, delete-orphan")
    service_logs = relationship("ServiceLog",        back_populates="performed_by")


class VehicleAssignment(Base):  # type: ignore
    __tablename__ = "vehicle_assignments"
    __table_args__ = (
        UniqueConstraint("vehicle_id", "person_id", name="uq_assignment"),
    )

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    person_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("maint_persons.id"), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    vehicle = relationship("Vehicle",           back_populates="assignments")
    person  = relationship("MaintenancePerson", back_populates="assignments")


# ---------------------------------------------------------------------------
# Service logs
# ---------------------------------------------------------------------------

class ServiceLog(Base):  # type: ignore
    __tablename__ = "vehicle_service_logs"

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    performed_by_id: Mapped[Optional[Any]] = mapped_column(Uuid(as_uuid=True), ForeignKey("maint_persons.id"), nullable=True)
    service_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    service_type: Mapped[Optional[str]] = mapped_column(String,   nullable=True)
    odometer: Mapped[Optional[int]] = mapped_column(Integer,  nullable=True)
    is_pro_service: Mapped[bool] = mapped_column(Boolean,  default=False, nullable=False)
    service_center: Mapped[Optional[str]] = mapped_column(String,   nullable=True)
    cost: Mapped[Optional[Any]] = mapped_column(Numeric(10, 2), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    receipt_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    vehicle       = relationship("Vehicle",           back_populates="service_logs")
    performed_by  = relationship("MaintenancePerson", back_populates="service_logs")
    check_results = relationship("ServiceCheckResult", back_populates="log", cascade="all, delete-orphan")


class ServiceCheckResult(Base):  # type: ignore
    """
    Result of a single inspection item within a service log.

    actual_value  — what was measured/observed (string)
    status        — pass / warn / fail (auto-calculated or manual)
    passed        — legacy boolean; status takes precedence when set
    """
    __tablename__ = "vehicle_service_check_results"

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    log_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("vehicle_service_logs.id"), nullable=False)
    check_point_id: Mapped[Optional[Any]] = mapped_column(Uuid(as_uuid=True), ForeignKey("vehicle_check_points.id"), nullable=True)
    description: Mapped[str] = mapped_column(String,  nullable=False)
    actual_value: Mapped[Optional[str]] = mapped_column(String,  nullable=True)
    status: Mapped[Optional[CheckStatus]] = mapped_column(Enum(CheckStatus), nullable=True)
    passed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    log         = relationship("ServiceLog",       back_populates="check_results")
    check_point = relationship("VehicleCheckPoint", back_populates="check_results")
