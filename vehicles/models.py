"""
vehicles/models.py

SQLAlchemy models for the Maintenance Pulse vehicle tracker.

Schema
------
Vehicle             — a user's vehicle (private per user)
VehicleFluidSpec    — fluid specs tied to a vehicle
VehicleTorqueSpec   — torque values tied to a vehicle
VehicleCheckPoint   — inspection/maintenance items with interval tracking
MaintenancePerson   — a person (app user) added to a garage owner's roster
VehicleAssignment   — many-to-many: MaintenancePerson ↔ Vehicle
ServiceLog          — a maintenance event (DIY or professional service)
ServiceCheckResult  — per-checklist result with actual measurement values
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean,
    Column,
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
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def _now() -> datetime:
    return datetime.now(timezone.utc)


class VehicleType(PyEnum):
    AUTO      = "auto"
    MOTO      = "moto"
    TRUCK     = "truck"
    ATV       = "atv"
    OTHER     = "other"


class CheckStatus(PyEnum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"


class Vehicle(Base):
    __tablename__ = "vehicles"

    id               = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_user_id = Column(String, nullable=False, index=True)
    year             = Column(Integer, nullable=True)
    make             = Column(String,  nullable=False)
    model            = Column(String,  nullable=False)
    trim             = Column(String,  nullable=True)
    nickname         = Column(String,  nullable=True)
    vehicle_type     = Column(Enum(VehicleType), default=VehicleType.AUTO, nullable=False)
    vin              = Column(String,  nullable=True)
    license_plate    = Column(String,  nullable=True)
    color            = Column(String,  nullable=True)
    notes            = Column(Text,    nullable=True)
    created_at       = Column(DateTime, default=_now)
    updated_at       = Column(DateTime, default=_now, onupdate=_now)

    fluid_specs   = relationship("VehicleFluidSpec",   back_populates="vehicle", cascade="all, delete-orphan")
    torque_specs  = relationship("VehicleTorqueSpec",  back_populates="vehicle", cascade="all, delete-orphan")
    check_points  = relationship("VehicleCheckPoint",  back_populates="vehicle", cascade="all, delete-orphan")
    service_logs  = relationship("ServiceLog",         back_populates="vehicle", cascade="all, delete-orphan")
    assignments   = relationship("VehicleAssignment",  back_populates="vehicle", cascade="all, delete-orphan")


class VehicleFluidSpec(Base):
    __tablename__ = "vehicle_fluid_specs"

    id         = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id = Column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    name       = Column(String, nullable=False)
    spec       = Column(String, nullable=True)
    volume     = Column(String, nullable=True)

    vehicle = relationship("Vehicle", back_populates="fluid_specs")


class VehicleTorqueSpec(Base):
    __tablename__ = "vehicle_torque_specs"

    id         = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id = Column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    name       = Column(String, nullable=False)
    ft_lb      = Column(Float,  nullable=True)
    nm         = Column(Float,  nullable=True)

    vehicle = relationship("Vehicle", back_populates="torque_specs")


class VehicleCheckPoint(Base):
    """
    An inspection or maintenance item for a vehicle.

    interval_miles  — service interval in miles (e.g. 3750 for chain tension)
    interval_days   — service interval in days (e.g. 14 for tire pressure check)
    expected_spec   — human-readable spec string (e.g. "20-30mm slack")
    min_value       — lower bound for auto pass/warn/fail calculation
    max_value       — upper bound
    unit            — unit of actual_value (e.g. "mm", "PSI", "°F")

    If both interval_miles and interval_days are set, whichever comes first triggers due.
    """
    __tablename__ = "vehicle_check_points"

    id             = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id     = Column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    description    = Column(String, nullable=False)
    sort_order     = Column(Integer, default=0, nullable=False)
    # Interval tracking
    interval_miles = Column(Integer, nullable=True)
    interval_days  = Column(Integer, nullable=True)
    # Spec / measurement guidance
    expected_spec  = Column(String,  nullable=True)
    min_value      = Column(Float,   nullable=True)
    max_value      = Column(Float,   nullable=True)
    unit           = Column(String,  nullable=True)

    vehicle      = relationship("Vehicle", back_populates="check_points")
    check_results = relationship("ServiceCheckResult", back_populates="check_point")


class MaintenancePerson(Base):
    __tablename__ = "maint_persons"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "external_user_id", name="uq_person_per_owner"),
    )

    id               = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id    = Column(String, nullable=False, index=True)
    external_user_id = Column(String, nullable=False, index=True)
    email            = Column(String, nullable=False)
    display_name     = Column(String, nullable=True)
    created_at       = Column(DateTime, default=_now)

    assignments  = relationship("VehicleAssignment", back_populates="person", cascade="all, delete-orphan")
    service_logs = relationship("ServiceLog",        back_populates="performed_by")


class VehicleAssignment(Base):
    __tablename__ = "vehicle_assignments"
    __table_args__ = (
        UniqueConstraint("vehicle_id", "person_id", name="uq_assignment"),
    )

    id          = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id  = Column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    person_id   = Column(Uuid(as_uuid=True), ForeignKey("maint_persons.id"), nullable=False)
    assigned_at = Column(DateTime, default=_now)

    vehicle = relationship("Vehicle",           back_populates="assignments")
    person  = relationship("MaintenancePerson", back_populates="assignments")


class ServiceLog(Base):
    """
    A single maintenance event.

    performed_by_id — which MaintenancePerson did the work
    service_type    — short label e.g. "Oil Change"
    is_pro_service  — True → professional shop; False → DIY
    """
    __tablename__ = "vehicle_service_logs"

    id              = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id      = Column(Uuid(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    performed_by_id = Column(Uuid(as_uuid=True), ForeignKey("maint_persons.id"), nullable=True)
    service_date    = Column(DateTime, nullable=False, default=_now)
    service_type    = Column(String,   nullable=True)
    odometer        = Column(Integer,  nullable=True)
    is_pro_service  = Column(Boolean,  default=False, nullable=False)
    service_center  = Column(String,   nullable=True)
    cost            = Column(Numeric(10, 2), nullable=True)
    notes           = Column(Text, nullable=True)
    receipt_path    = Column(String, nullable=True)
    created_at      = Column(DateTime, default=_now)

    vehicle       = relationship("Vehicle",           back_populates="service_logs")
    performed_by  = relationship("MaintenancePerson", back_populates="service_logs")
    check_results = relationship("ServiceCheckResult", back_populates="log", cascade="all, delete-orphan")


class ServiceCheckResult(Base):
    """
    Result of a single inspection item within a service log.

    check_point_id — links back to VehicleCheckPoint (nullable: supports ad-hoc descriptions)
    actual_value   — measured value as string (e.g. "24", "31 PSI", "OK")
    status         — pass / warn / fail (auto-calculated if min/max set, otherwise manual)
    passed         — legacy boolean; ignored when status is set
    """
    __tablename__ = "vehicle_service_check_results"

    id              = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    log_id          = Column(Uuid(as_uuid=True), ForeignKey("vehicle_service_logs.id"), nullable=False)
    check_point_id  = Column(Uuid(as_uuid=True), ForeignKey("vehicle_check_points.id"), nullable=True)
    description     = Column(String,  nullable=False)
    actual_value    = Column(String,  nullable=True)
    status          = Column(Enum(CheckStatus), nullable=True)
    passed          = Column(Boolean, default=True, nullable=False)

    log         = relationship("ServiceLog",      back_populates="check_results")
    check_point = relationship("VehicleCheckPoint", back_populates="check_results")
