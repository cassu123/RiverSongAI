# =============================================================================
# core/errors.py
#
# Centralised error handling for River Song AI.
#
# Usage in route handlers:
#   from core.errors import api_error, not_found, forbidden, bad_request
#
#   raise not_found("Recipe not found")
#   raise bad_request("Invalid barcode")
#   raise forbidden("Admin only")
#   raise api_error("Unexpected failure", exc)   # logs + 500
#
# Usage in background tasks / providers:
#   from core.errors import log_exc
#   log_exc(logger, "context description", exc)
# =============================================================================

from __future__ import annotations

import logging
from typing import Optional

from fastapi import HTTPException

_logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HTTP helpers — raise these instead of raw HTTPException
# ---------------------------------------------------------------------------

def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def not_found(detail: str = "Not found") -> HTTPException:
    return HTTPException(status_code=404, detail=detail)


def forbidden(detail: str = "Forbidden") -> HTTPException:
    return HTTPException(status_code=403, detail=detail)


def unauthorized(detail: str = "Authentication required") -> HTTPException:
    return HTTPException(status_code=401, detail=detail)


def conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=409, detail=detail)


def api_error(detail: str, exc: Optional[Exception] = None,
              log: logging.Logger = _logger) -> HTTPException:
    """Log an unexpected exception and return a 500 HTTPException."""
    if exc is not None:
        log.error("%s: %s", detail, exc, exc_info=True)
    else:
        log.error(detail)
    return HTTPException(status_code=500, detail=detail)


# ---------------------------------------------------------------------------
# Background task helper
# ---------------------------------------------------------------------------

def log_exc(log: logging.Logger, context: str, exc: Exception) -> None:
    """Uniform one-liner for logging non-fatal exceptions in background tasks."""
    log.warning("%s: %s", context, exc)
