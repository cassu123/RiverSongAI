"""Sweeps framework package."""

from core.sweeps.registry import (
    SweepDefinition,
    get_registry,
    register_sweep,
    start_sweeps,
    stop_sweeps,
)

__all__ = [
    "SweepDefinition",
    "get_registry",
    "register_sweep",
    "start_sweeps",
    "stop_sweeps",
]
