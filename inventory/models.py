import uuid
from datetime import datetime, date, timezone
from enum import Enum as PyEnum

def _now():
    return datetime.now(timezone.utc)

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    Uuid,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


# ---------------------------------------------------------------------------
# Enums  (must be defined before they are referenced in Table/Column)
# ---------------------------------------------------------------------------

class CollaboratorRole(PyEnum):
    VIEWER = "viewer"
    EDITOR = "editor"


class QRCodeStandard(PyEnum):
    QR      = "qr"        # standard QR code
    CODE128 = "code128"   # 1-D barcode (scanners / warehouses)
    EIN     = "ein"       # plain EIN text label (no image encoding)


class AssetStatus(PyEnum):
    SERVICEABLE   = "Serviceable"
    UNSERVICEABLE = "Unserviceable"
    MISSING       = "Missing"
    IN_USE        = "In-Use"


class ItemCategory(PyEnum):
    ELECTRONICS    = "Electronics"
    FURNITURE      = "Furniture"
    APPLIANCE      = "Appliance"
    TOOL           = "Tool"
    CLOTHING       = "Clothing"
    DOCUMENT       = "Document"
    VEHICLE        = "Vehicle"
    JEWELRY        = "Jewelry"
    COLLECTIBLE    = "Collectible"
    SPORTING_GOODS = "Sporting Goods"
    OTHER          = "Other"


class AuditStatus(PyEnum):
    IN_PROGRESS = "in_progress"
    COMPLETED   = "completed"



collaborators_table = Table(
    "inv_collaborators",
    Base.metadata,
    Column("user_id",    Uuid(as_uuid=True), ForeignKey("inv_users.id"),  primary_key=True),
    Column("home_id",    Uuid(as_uuid=True), ForeignKey("inv_homes.id"),  primary_key=True),
    Column("role",       Enum(CollaboratorRole), default=CollaboratorRole.VIEWER, nullable=False),
    Column("created_at", DateTime, default=_now),
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class InvUser(Base):
    """
    Inventory-specific user record.  Linked to the main River Song user via
    external_user_id (the JWT sub / River Song user.id).
    """
    __tablename__ = "inv_users"

    id               = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_user_id = Column(String, unique=True, nullable=False, index=True)
    email            = Column(String, unique=True, nullable=False, index=True)
    display_name     = Column(String, nullable=True)
    created_at       = Column(DateTime, default=_now)
    updated_at       = Column(DateTime, default=_now, onupdate=_now)

    homes_owned       = relationship("InvHome", back_populates="owner", cascade="all, delete-orphan")
    homes_collaborating = relationship(
        "InvHome", secondary=collaborators_table, back_populates="collaborators"
    )
    timezone = Column(String, default="UTC", nullable=False)


class InvHome(Base):
    """A named location (house, apartment, storage unit, office, etc.)."""
    __tablename__ = "inv_homes"

    id                    = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name                  = Column(String, nullable=False)
    description           = Column(Text, nullable=True)
    owner_id              = Column(Uuid(as_uuid=True), ForeignKey("inv_users.id"), nullable=False)
    default_qr_standard   = Column(Enum(QRCodeStandard), default=QRCodeStandard.QR, nullable=False)
    created_at            = Column(DateTime, default=_now)
    updated_at            = Column(DateTime, default=_now, onupdate=_now)

    owner            = relationship("InvUser", back_populates="homes_owned")
    inventory_items  = relationship("InventoryItem", back_populates="home", cascade="all, delete-orphan")
    collaborators    = relationship(
        "InvUser", secondary=collaborators_table, back_populates="homes_collaborating"
    )


class ItemAttachment(Base):
    """A file attached to an inventory item."""
    __tablename__ = "inv_item_attachments"

    id                = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id           = Column(Uuid(as_uuid=True), ForeignKey("inventory_items.id"), nullable=False, index=True)
    original_filename = Column(String, nullable=False)
    stored_path       = Column(String, nullable=False)   # relative to INVENTORY_FILES_BASE_DIR
    file_size         = Column(Integer, nullable=True)
    mime_type         = Column(String, nullable=True)
    created_at        = Column(DateTime, default=_now)

    item = relationship("InventoryItem", back_populates="attachments")


class InventoryItem(Base):
    """
    A physical asset tracked within a home.

    Core identification
    -------------------
    ein              — Equipment Identification Number, auto-generated, human-readable
    qr_code_data     — base64-encoded PNG of the QR/barcode image

    Physical details
    ----------------
    name, category, description, quantity
    manufacturer, model_number, serial_number
    location         — room or area within the home (e.g. "Kitchen", "Garage")

    Financial / warranty
    --------------------
    purchase_price, purchase_date, replacement_cost
    warranty_expiry_date
    receipt_image_path, warranty_image_path

    Custody / status
    ----------------
    asset_status, current_custodian_id, issued_at
    """
    __tablename__ = "inventory_items"

    # --- identity ---
    id      = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ein     = Column(String, unique=True, nullable=False, index=True)
    home_id = Column(Uuid(as_uuid=True), ForeignKey("inv_homes.id"), nullable=False)

    # --- core details ---
    name        = Column(String,             nullable=False, index=True)
    category    = Column(Enum(ItemCategory), default=ItemCategory.OTHER, nullable=False)
    description = Column(Text,               nullable=True)
    quantity    = Column(Integer,            default=1, nullable=False)
    location    = Column(String,             nullable=True)   # room / area

    # --- make / model ---
    manufacturer  = Column(String, nullable=True)
    model_number  = Column(String, nullable=True)
    serial_number = Column(String, nullable=True, index=True)

    # --- financial ---
    purchase_price    = Column(Numeric(10, 2), nullable=True)
    purchase_date     = Column(Date,           nullable=True)
    replacement_cost  = Column(Numeric(10, 2), nullable=True)

    # --- warranty ---
    warranty_expiry_date = Column(Date,   nullable=True)
    warranty_image_path  = Column(String, nullable=True)

    # --- receipt ---
    receipt_image_path = Column(String, nullable=True)

    # --- QR / label ---
    qr_standard  = Column(Enum(QRCodeStandard), default=QRCodeStandard.QR, nullable=False)
    qr_code_data = Column(Text, nullable=True)   # base64 PNG or SVG

    # --- custody / status ---
    asset_status         = Column(Enum(AssetStatus), default=AssetStatus.SERVICEABLE, nullable=False)
    current_custodian_id = Column(Uuid(as_uuid=True), ForeignKey("inv_users.id"), nullable=True)
    issued_at            = Column(DateTime, nullable=True)

    # --- flags ---
    is_insured = Column(Boolean, default=False, nullable=False)

    # --- timestamps ---
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    # --- relationships ---
    home              = relationship("InvHome", back_populates="inventory_items")
    current_custodian = relationship("InvUser", foreign_keys=[current_custodian_id])
    attachments       = relationship("ItemAttachment", back_populates="item", cascade="all, delete-orphan")


class InventoryAudit(Base):
    """A physical inventory audit session for a home."""
    __tablename__ = "inv_audits"

    id             = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    home_id        = Column(Uuid(as_uuid=True), ForeignKey("inv_homes.id"), nullable=False, index=True)
    created_by_id  = Column(Uuid(as_uuid=True), ForeignKey("inv_users.id"), nullable=False)
    status         = Column(Enum(AuditStatus), default=AuditStatus.IN_PROGRESS, nullable=False)
    total_items    = Column(Integer, default=0, nullable=False)   # snapshot at start
    scanned_count  = Column(Integer, default=0, nullable=False)
    notes          = Column(String(500), nullable=True)
    user_timezone  = Column(String, default="UTC", nullable=False)
    started_at     = Column(DateTime, default=_now)
    completed_at   = Column(DateTime, nullable=True)

    home       = relationship("InvHome")
    created_by = relationship("InvUser", foreign_keys=[created_by_id])
    scans      = relationship("AuditScan", back_populates="audit", cascade="all, delete-orphan")


class AuditScan(Base):
    """A single EIN scan recorded during an audit session."""
    __tablename__ = "inv_audit_scans"

    id         = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    audit_id   = Column(Uuid(as_uuid=True), ForeignKey("inv_audits.id"), nullable=False, index=True)
    item_id    = Column(Uuid(as_uuid=True), ForeignKey("inventory_items.id"), nullable=False)
    ein        = Column(String, nullable=False)
    scanned_at = Column(DateTime, default=_now)

    audit = relationship("InventoryAudit", back_populates="scans")
    item  = relationship("InventoryItem")
