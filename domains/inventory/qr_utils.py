"""
inventory/qr_utils.py

EIN generation and QR / barcode image creation.

EIN format:  EIN-XXXX-XXXX-XXXX   (uppercase alphanumeric, no ambiguous chars)

generate_ein()            -- produce a unique, human-readable Equipment ID Number
generate_qr_png_b64()     -- QR code image as a base64-encoded PNG string
generate_barcode_png_b64()-- Code-128 barcode image as a base64-encoded PNG string
"""

from __future__ import annotations

import base64
import io
import logging
import random
import string

logger = logging.getLogger(__name__)

# Characters that are easy to read on a printed label (no 0/O, 1/I/l)
_EIN_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_ein() -> str:
    """
    Return a new EIN string in the format EIN-XXXX-XXXX-XXXX.
    Uniqueness is enforced by the caller (database UNIQUE constraint).
    """
    def segment(n: int) -> str:
        return "".join(random.choices(_EIN_CHARS, k=n))

    return f"EIN-{segment(4)}-{segment(4)}-{segment(4)}"


def generate_qr_png_b64(payload: str) -> str | None:
    """
    Generate a QR code for *payload* and return it as a base64-encoded PNG.
    Returns None if the qrcode library is not installed.
    """
    try:
        import qrcode
        from qrcode.image.pure import PyPNGImage
    except ImportError:
        logger.warning("qrcode library not installed — QR generation disabled. Run: pip install qrcode[pil]")
        return None

    try:
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=8,
            border=3,
        )
        qr.add_data(payload)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as exc:
        logger.error("QR generation failed: %s", exc)
        return None


def generate_barcode_png_b64(payload: str) -> str | None:
    """
    Generate a Code-128 barcode for *payload* and return it as a base64-encoded PNG.
    Returns None if the python-barcode library is not installed.
    """
    try:
        import barcode
        from barcode.writer import ImageWriter
    except ImportError:
        logger.warning("python-barcode library not installed — barcode generation disabled. Run: pip install python-barcode[images]")
        return None

    try:
        code128_cls = barcode.get_barcode_class("code128")
        buf         = io.BytesIO()
        code128_cls(payload, writer=ImageWriter()).write(buf)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode("ascii")
    except Exception as exc:
        logger.error("Barcode generation failed: %s", exc)
        return None


def generate_label_data(item) -> str:
    """
    Build the payload string that gets encoded into the QR code / barcode.
    Format is intentionally URL-safe so it can double as a deep-link later.
    """
    parts = [f"ein={item.ein}"]
    if item.name:
        parts.append(f"name={item.name}")
    if item.serial_number:
        parts.append(f"sn={item.serial_number}")
    return "&".join(parts)
