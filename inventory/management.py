"""
inventory/management.py

Business-logic layer for the inventory system.  All database writes go through
here so that API routes stay thin.

Functions
---------
create_home              -- create a new home for a user
get_homes_for_user       -- list homes owned or collaborated on
create_item              -- add an item to a home (generates EIN + QR code)
update_item              -- patch any fields on an item
delete_item              -- remove an item
get_items_for_home       -- list all items in a home
get_item                 -- fetch a single item by id or EIN
fast_scan_item           -- look up by EIN and return item details
issue_item               -- assign custody of an item to a collaborator
return_item              -- release custody back to unassigned
manage_collaborators     -- add / remove / update-role collaborators
edit_home                -- rename a home or change its QR standard
process_receipt          -- attach a receipt image and extract price/date
generate_insurance_manifest -- produce a PDF report of serviceable items
"""

from __future__ import annotations

import logging
import os
import uuid as _uuid_mod
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import and_
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session

from .auth import (
    HomeNotFoundError,
    PermissionDeniedError,
    set_active_home,
)
from .file_utils import (
    INVENTORY_FILES_BASE_DIR,
    extract_data_from_receipt,
    save_file_for_home,
)
from .models import (
    AssetStatus,
    CollaboratorRole,
    InventoryItem,
    InvHome,
    InvUser,
    ItemCategory,
    QRCodeStandard,
    collaborators_table,
)
from .qr_utils import (
    generate_barcode_png_b64,
    generate_ein,
    generate_label_data,
    generate_qr_png_b64,
)

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid(s) -> _uuid_mod.UUID:
    """Convert str/UUID to uuid.UUID for Uuid(as_uuid=True) column comparisons."""
    if isinstance(s, _uuid_mod.UUID):
        return s
    return _uuid_mod.UUID(str(s))


# ---------------------------------------------------------------------------
# User bootstrap
# ---------------------------------------------------------------------------

def get_or_create_inv_user(db: Session, external_user_id: str, email: str, display_name: str = "") -> InvUser:
    """Ensure an InvUser row exists for the given River Song user."""
    user = db.query(InvUser).filter(InvUser.external_user_id == external_user_id).first()
    if user:
        return user
    user = InvUser(
        external_user_id=external_user_id,
        email=email,
        display_name=display_name or email,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Homes
# ---------------------------------------------------------------------------

def create_home(db: Session, owner: InvUser, name: str, description: str = "", qr_standard: QRCodeStandard = QRCodeStandard.QR) -> InvHome:
    home = InvHome(
        name=name,
        description=description,
        owner_id=owner.id,
        default_qr_standard=qr_standard,
    )
    db.add(home)
    db.commit()
    db.refresh(home)
    logger.info("Home created: %s (owner=%s)", home.id, owner.id)
    return home


def get_homes_for_user(db: Session, user: InvUser) -> list[InvHome]:
    owned       = db.query(InvHome).filter(InvHome.owner_id == user.id).all()
    collaborated = user.homes_collaborating
    seen = {h.id for h in owned}
    return owned + [h for h in collaborated if h.id not in seen]


def edit_home(
    db: Session,
    owner_user_id: str,
    home_id: str,
    new_name: Optional[str] = None,
    new_description: Optional[str] = None,
    new_qr_standard: Optional[QRCodeStandard] = None,
) -> InvHome:
    home = set_active_home(db, owner_user_id, home_id)
    if str(home.owner_id) != owner_user_id:
        raise PermissionDeniedError(f"Only the home owner can edit home details.")
    if new_name        is not None: home.name            = new_name
    if new_description is not None: home.description     = new_description
    if new_qr_standard is not None: home.default_qr_standard = new_qr_standard
    db.commit()
    db.refresh(home)
    return home


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------

def _attach_qr(db: Session, item: InventoryItem) -> None:
    """Generate and persist QR / barcode data for an item."""
    payload = generate_label_data(item)
    if item.qr_standard == QRCodeStandard.CODE128:
        item.qr_code_data = generate_barcode_png_b64(payload)
    elif item.qr_standard == QRCodeStandard.EIN:
        item.qr_code_data = None  # plain EIN label, no image
    else:
        item.qr_code_data = generate_qr_png_b64(payload)
    db.commit()


def create_item(
    db: Session,
    user_id: str,
    home_id: str,
    name: str,
    category: ItemCategory = ItemCategory.OTHER,
    description: str = "",
    quantity: int = 1,
    location: str = "",
    manufacturer: str = "",
    model_number: str = "",
    serial_number: str = "",
    purchase_price: Optional[float] = None,
    purchase_date=None,
    replacement_cost: Optional[float] = None,
    warranty_expiry_date=None,
    is_insured: bool = False,
    qr_standard: Optional[QRCodeStandard] = None,
) -> InventoryItem:
    home = set_active_home(db, user_id, home_id)

    # Generate a unique EIN (retry on collision, though astronomically unlikely)
    for _ in range(5):
        ein = generate_ein()
        if not db.query(InventoryItem).filter(InventoryItem.ein == ein).first():
            break

    item = InventoryItem(
        ein=ein,
        home_id=home.id,
        name=name,
        category=category,
        description=description,
        quantity=quantity,
        location=location,
        manufacturer=manufacturer,
        model_number=model_number,
        serial_number=serial_number,
        purchase_price=Decimal(str(purchase_price)) if purchase_price is not None else None,
        purchase_date=purchase_date,
        replacement_cost=Decimal(str(replacement_cost)) if replacement_cost is not None else None,
        warranty_expiry_date=warranty_expiry_date,
        is_insured=is_insured,
        qr_standard=qr_standard or home.default_qr_standard,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    _attach_qr(db, item)
    db.refresh(item)
    logger.info("Item created: %s / EIN=%s", item.id, item.ein)
    return item


def update_item(db: Session, user_id: str, item_id: str, **fields) -> InventoryItem:
    item = _get_item_or_raise(db, item_id)
    set_active_home(db, user_id, str(item.home_id))

    numeric_fields = {"purchase_price", "replacement_cost"}
    for key, val in fields.items():
        if val is None:
            continue
        if key in numeric_fields and val is not None:
            val = Decimal(str(val))
        setattr(item, key, val)

    # Regenerate QR if name, serial, or standard changed
    if any(k in fields for k in ("name", "serial_number", "qr_standard")):
        _attach_qr(db, item)

    db.commit()
    db.refresh(item)
    return item


def delete_item(db: Session, user_id: str, item_id: str) -> None:
    item = _get_item_or_raise(db, item_id)
    set_active_home(db, user_id, str(item.home_id))
    db.delete(item)
    db.commit()


def get_items_for_home(db: Session, user_id: str, home_id: str) -> list[InventoryItem]:
    set_active_home(db, user_id, home_id)
    return db.query(InventoryItem).filter(InventoryItem.home_id == _uid(home_id)).order_by(InventoryItem.name).all()


def get_item(db: Session, user_id: str, item_id: str) -> InventoryItem:
    item = _get_item_or_raise(db, item_id)
    set_active_home(db, user_id, str(item.home_id))
    return item


def fast_scan_item(db: Session, user_id: str, ein: str) -> InventoryItem:
    """Look up an item by EIN (as scanned from a QR code or barcode)."""
    item = db.query(InventoryItem).filter(InventoryItem.ein == ein).first()
    if not item:
        raise NoResultFound(f"No item found with EIN '{ein}'.")
    set_active_home(db, user_id, str(item.home_id))
    return item


# ---------------------------------------------------------------------------
# Custody
# ---------------------------------------------------------------------------

def issue_item(db: Session, admin_user_id: str, item_id: str, collaborator_user_id: str) -> InventoryItem:
    item = _get_item_or_raise(db, item_id)
    home = db.query(InvHome).filter(InvHome.id == _uid(item.home_id)).first()
    if not home or str(home.owner_id) != admin_user_id:
        raise PermissionDeniedError("Only the home owner can issue items.")

    collaborator = db.query(InvUser).filter(InvUser.id == _uid(collaborator_user_id)).first()
    if not collaborator:
        raise NoResultFound(f"User '{collaborator_user_id}' not found.")
    if item.current_custodian_id == collaborator.id:
        raise ValueError(f"Item '{item.name}' is already issued to that user.")

    item.current_custodian_id = collaborator.id
    item.issued_at            = _now()
    item.asset_status         = AssetStatus.IN_USE
    db.commit()
    db.refresh(item)
    return item


def return_item(db: Session, user_id: str, item_id: str) -> InventoryItem:
    item = _get_item_or_raise(db, item_id)
    home = db.query(InvHome).filter(InvHome.id == _uid(item.home_id)).first()
    # Owner or current custodian can return
    if str(home.owner_id) != user_id and str(item.current_custodian_id) != user_id:
        raise PermissionDeniedError("Only the home owner or current custodian can return an item.")

    item.current_custodian_id = None
    item.issued_at            = None
    item.asset_status         = AssetStatus.SERVICEABLE
    db.commit()
    db.refresh(item)
    return item


# ---------------------------------------------------------------------------
# Collaborators
# ---------------------------------------------------------------------------

def manage_collaborators(
    db: Session,
    owner_user_id: str,
    home_id: str,
    collaborator_user_id: str,
    action: str,
    role: CollaboratorRole = CollaboratorRole.VIEWER,
) -> InvHome:
    home = db.query(InvHome).filter(InvHome.id == _uid(home_id)).first()
    if not home:
        raise HomeNotFoundError(f"Home '{home_id}' not found.")
    if str(home.owner_id) != owner_user_id:
        raise PermissionDeniedError("Only the home owner can manage collaborators.")

    collab = db.query(InvUser).filter(InvUser.id == _uid(collaborator_user_id)).first()
    if not collab:
        raise NoResultFound(f"User '{collaborator_user_id}' not found.")

    if action == "add":
        if collaborator_user_id == owner_user_id:
            raise ValueError("Cannot add the owner as a collaborator.")
        existing = db.execute(
            collaborators_table.select().where(
                and_(
                    collaborators_table.c.user_id == _uid(collaborator_user_id),
                    collaborators_table.c.home_id == _uid(home_id),
                )
            )
        ).first()
        if existing:
            raise ValueError(f"'{collab.email}' is already a collaborator.")
        db.execute(collaborators_table.insert().values(
            user_id=_uid(collaborator_user_id), home_id=_uid(home_id), role=role, created_at=_now()
        ))

    elif action == "remove":
        result = db.execute(collaborators_table.delete().where(
            and_(
                collaborators_table.c.user_id == _uid(collaborator_user_id),
                collaborators_table.c.home_id == _uid(home_id),
            )
        ))
        if result.rowcount == 0:
            raise NoResultFound(f"'{collab.email}' is not a collaborator of this home.")

    elif action == "update_role":
        result = db.execute(collaborators_table.update().where(
            and_(
                collaborators_table.c.user_id == _uid(collaborator_user_id),
                collaborators_table.c.home_id == _uid(home_id),
            )
        ).values(role=role))
        if result.rowcount == 0:
            raise NoResultFound(f"'{collab.email}' is not a collaborator of this home.")

    else:
        raise ValueError(f"Invalid action '{action}'. Use 'add', 'remove', or 'update_role'.")

    db.commit()
    db.refresh(home)
    return home


# ---------------------------------------------------------------------------
# Receipt processing
# ---------------------------------------------------------------------------

def process_receipt(
    db: Session,
    user_id: str,
    item_id: str,
    receipt_data: bytes,
    receipt_filename: str,
    manual_price: Optional[float] = None,
    manual_date=None,
) -> InventoryItem:
    item = _get_item_or_raise(db, item_id)
    set_active_home(db, user_id, str(item.home_id))

    rel_path = save_file_for_home(str(item.home_id), "receipts", receipt_data, receipt_filename)
    item.receipt_image_path = rel_path

    full_path = os.path.join(INVENTORY_FILES_BASE_DIR, rel_path)
    # Path traversal guard
    if not os.path.abspath(full_path).startswith(os.path.abspath(INVENTORY_FILES_BASE_DIR)):
        raise ValueError("Invalid file path.")
    extracted_price, extracted_date = extract_data_from_receipt(full_path)

    item.purchase_price = (
        Decimal(str(manual_price)) if manual_price is not None
        else (Decimal(str(extracted_price)) if extracted_price is not None else item.purchase_price)
    )
    item.purchase_date = manual_date or extracted_date or item.purchase_date

    db.commit()
    db.refresh(item)
    return item


# ---------------------------------------------------------------------------
# Insurance PDF manifest
# ---------------------------------------------------------------------------

def generate_insurance_manifest(db: Session, user_id: str, home_id: str) -> str:
    """
    Generate a PDF listing all serviceable items and their replacement costs.
    Returns the absolute path to the generated PDF.
    Requires reportlab: pip install reportlab
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError:
        raise RuntimeError("reportlab is required for PDF generation. Run: pip install reportlab")

    home  = set_active_home(db, user_id, home_id)
    items = (
        db.query(InventoryItem)
        .filter(
            InventoryItem.home_id    == home_id,
            InventoryItem.asset_status == AssetStatus.SERVICEABLE,
        )
        .order_by(InventoryItem.category, InventoryItem.name)
        .all()
    )

    total = sum(
        (i.replacement_cost or Decimal("0")) * i.quantity for i in items
    )

    out_dir = os.path.join(INVENTORY_FILES_BASE_DIR, f"home_{home_id}", "reports")
    os.makedirs(out_dir, exist_ok=True)
    ts       = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    pdf_path = os.path.join(out_dir, f"insurance_manifest_{ts}.pdf")

    styles = getSampleStyleSheet()
    story  = [
        Paragraph(f"Insurance Manifest — {home.name}", styles["h1"]),
        Paragraph(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", styles["Normal"]),
        Spacer(1, 0.25 * inch),
    ]

    headers = ["EIN", "Name", "Category", "Qty", "Location", "Serial No.", "Replacement Cost", "Total"]
    rows    = [headers]
    for i in items:
        rc    = i.replacement_cost or Decimal("0")
        total_item = rc * i.quantity
        rows.append([
            i.ein,
            i.name,
            i.category.value if i.category else "",
            str(i.quantity),
            i.location or "",
            i.serial_number or "",
            f"${rc:.2f}",
            f"${total_item:.2f}",
        ])

    tbl = Table(rows, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0),  colors.HexColor("#2b2b2b")),
        ("TEXTCOLOR",    (0, 0), (-1, 0),  colors.whitesmoke),
        ("FONTNAME",     (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, 0),  8),
        ("BACKGROUND",   (0, 1), (-1, -1), colors.HexColor("#f5f5f5")),
        ("ROWBACKGROUNDS",(0,1), (-1,-1),  [colors.white, colors.HexColor("#f0f0f0")]),
        ("GRID",         (0, 0), (-1, -1), 0.5, colors.grey),
        ("ALIGN",        (3, 0), (3, -1),  "CENTER"),
        ("ALIGN",        (6, 0), (7, -1),  "RIGHT"),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 0.25 * inch))
    story.append(Paragraph(f"<b>Total Estimated Replacement Value (Serviceable): ${total:.2f}</b>", styles["h3"]))

    SimpleDocTemplate(pdf_path, pagesize=letter).build(story)
    logger.info("Insurance manifest written: %s", pdf_path)
    return pdf_path


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

def _get_item_or_raise(db: Session, item_id: str) -> InventoryItem:
    item = db.query(InventoryItem).filter(InventoryItem.id == _uid(item_id)).first()
    if not item:
        raise NoResultFound(f"Item '{item_id}' not found.")
    return item
