"""
Odometer resolution in the vehicles API serializer.

`current_odometer` is what the Hangar renders on every fleet card and in the
telemetry cockpit, so the unit it comes back in matters: a car must never
report an engine-hour reading as its mileage.
"""

import importlib.util
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest

from domains.vehicles.models import UsageUnit, VehicleType

# Loaded by path rather than as `api.routes.vehicles`: importing the submodule
# runs `api/routes/__init__.py`, which pulls in every router in the app. These
# are pure serializer tests and need none of that.
_spec = importlib.util.spec_from_file_location(
    "_vehicles_routes_under_test",
    pathlib.Path(__file__).resolve().parents[1] / "api" / "routes" / "vehicles.py",
)
_vehicles_routes = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _vehicles_routes
_spec.loader.exec_module(_vehicles_routes)

_is_hour_metered = _vehicles_routes._is_hour_metered
_ser_vehicle = _vehicles_routes._ser_vehicle


T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
T1 = T0 + timedelta(days=30)
T2 = T0 + timedelta(days=60)


class FakeReading:
    def __init__(self, value, unit, recorded_at):
        self.id = "r1"
        self.vehicle_id = "v1"
        self.source = "manual"
        self.value = value
        self.unit = unit
        self.recorded_at = recorded_at


class FakeLog:
    def __init__(self, odometer):
        self.odometer = odometer


class FakeVehicle:
    """Only the attributes _ser_vehicle touches."""

    def __init__(self, vehicle_type, usage_readings=(), service_logs=()):
        self.id = "v1"
        self.vehicle_type = vehicle_type
        self.usage_readings = list(usage_readings)
        self.service_logs = list(service_logs)
        self.year = 2020
        self.make = "Test"
        self.model = "Unit"
        self.trim = None
        self.nickname = None
        self.vin = None
        self.license_plate = None
        self.color = None
        self.notes = None
        self.fluid_specs = []
        self.torque_specs = []
        self.check_points = []
        self.created_at = None
        self.updated_at = None


def odo(vehicle):
    d = _ser_vehicle(vehicle)
    return d["current_odometer"], d["current_odometer_unit"]


# --- hour-metered classification -------------------------------------------

@pytest.mark.parametrize(
    "vtype",
    [VehicleType.ATV, VehicleType.MOWER, VehicleType.TRACTOR, VehicleType.GENERATOR],
)
def test_non_road_types_are_hour_metered(vtype):
    assert _is_hour_metered(FakeVehicle(vtype)) is True


@pytest.mark.parametrize(
    "vtype",
    [VehicleType.AUTO, VehicleType.MOTO, VehicleType.TRUCK, VehicleType.OTHER],
)
def test_road_types_are_mile_metered(vtype):
    assert _is_hour_metered(FakeVehicle(vtype)) is False


# --- odometer resolution ----------------------------------------------------

def test_picks_the_latest_reading_not_the_first():
    v = FakeVehicle(
        VehicleType.AUTO,
        [
            FakeReading(1000, UsageUnit.MILES, T0),
            FakeReading(3000, UsageUnit.MILES, T2),
            FakeReading(2000, UsageUnit.MILES, T1),
        ],
    )
    assert odo(v) == (3000, "miles")


def test_a_stray_hours_reading_never_becomes_a_cars_mileage():
    """Regression: the miles filter was computed and then discarded, so the
    latest reading of *any* unit won — 120 engine hours displaced 50,000 mi."""
    v = FakeVehicle(
        VehicleType.AUTO,
        [
            FakeReading(50000, UsageUnit.MILES, T0),
            FakeReading(120, UsageUnit.HOURS, T2),
        ],
    )
    assert odo(v) == (50000, "miles")


def test_an_atv_prefers_its_hours_over_a_miles_reading():
    v = FakeVehicle(
        VehicleType.ATV,
        [
            FakeReading(300, UsageUnit.MILES, T0),
            FakeReading(88, UsageUnit.HOURS, T2),
        ],
    )
    assert odo(v) == (88, "hours")


def test_an_atv_with_only_legacy_miles_rows_still_reports_a_reading():
    """Older clients posted every reading as "miles" regardless of vehicle."""
    v = FakeVehicle(VehicleType.ATV, [FakeReading(88, UsageUnit.MILES, T1)])
    assert odo(v) == (88, "hours")


def test_falls_back_to_the_highest_service_log_odometer():
    v = FakeVehicle(
        VehicleType.AUTO,
        service_logs=[FakeLog(7000), FakeLog(9000), FakeLog(None)],
    )
    assert odo(v) == (9000, "miles")


def test_reports_no_odometer_when_nothing_was_ever_recorded():
    assert odo(FakeVehicle(VehicleType.MOTO)) == (None, "miles")


def test_tolerates_a_plain_string_unit_column():
    v = FakeVehicle(VehicleType.AUTO, [FakeReading(4200, "miles", T1)])
    assert odo(v) == (4200, "miles")


def test_ignores_readings_with_no_value_or_timestamp():
    v = FakeVehicle(
        VehicleType.AUTO,
        [
            FakeReading(None, UsageUnit.MILES, T2),
            FakeReading(1500, UsageUnit.MILES, None),
            FakeReading(1200, UsageUnit.MILES, T0),
        ],
    )
    assert odo(v) == (1200, "miles")
