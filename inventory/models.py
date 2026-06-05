from typing import Optional, Any
import uuid
from datetime import datetime, date, timezone
from enum import Enum as PyEnum

def _now():
    return datetime.now(timezone.utc)

from sqlalchemy import (  # type: ignore
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
from sqlalchemy.orm import declarative_base, Mapped, mapped_column, relationship

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

class InvUser(Base):  # type: ignore
    """
    Inventory-specific user record.  Linked to the main River Song user via
    external_user_id (the JWT sub / River Song user.id).
    """
    __tablename__ = "inv_users"

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_user_id: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    display_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    homes_owned       = relationship("InvHome", back_populates="owner", cascade="all, delete-orphan")
    homes_collaborating = relationship(
        "InvHome", secondary=collaborators_table, back_populates="collaborators"
    )
    timezone: Mapped[str] = mapped_column(String, default="UTC", nullable=False)


class InvHome(Base):  # type: ignore
    """A named location (house, apartment, storage unit, office, etc.)."""
    __tablename__ = "inv_homes"

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    owner_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("inv_users.id"), nullable=False)
    default_qr_standard: Mapped[QRCodeStandard] = mapped_column(Enum(QRCodeStandard), default=QRCodeStandard.QR, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    owner            = relationship("InvUser", back_populates="homes_owned")
    inventory_items  = relationship("InventoryItem", back_populates="home", cascade="all, delete-orphan")
    collaborators    = relationship(
        "InvUser", secondary=collaborators_table, back_populates="homes_collaborating"
    )


class ItemAttachment(Base):  # type: ignore
    """A file attached to an inventory item."""
    __tablename__ = "inv_item_attachments"

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("inventory_items.id"), nullable=False, index=True)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    stored_path: Mapped[str] = mapped_column(String, nullable=False)# relative to INVENTORY_FILES_BASE_DIR
    file_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    item = relationship("InventoryItem", back_populates="attachments")


class InventoryItem(Base):  # type: ignore
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
    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ein: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    home_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("inv_homes.id"), nullable=False)

    # --- core details ---
    name: Mapped[str] = mapped_column(String,             nullable=False, index=True)
    category: Mapped[ItemCategory] = mapped_column(Enum(ItemCategory), default=ItemCategory.OTHER, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text,               nullable=True)
    quantity: Mapped[int] = mapped_column(Integer,            default=1, nullable=False)
    location: Mapped[Optional[str]] = mapped_column(String,             nullable=True)# room / area

    # --- make / model ---
    manufacturer: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    model_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    serial_number: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)

    # --- financial ---
    purchase_price: Mapped[Optional[Any]] = mapped_column(Numeric(10, 2), nullable=True)
    purchase_date: Mapped[Optional[Any]] = mapped_column(Date,           nullable=True)
    replacement_cost: Mapped[Optional[Any]] = mapped_column(Numeric(10, 2), nullable=True)

    # --- warranty ---
    warranty_expiry_date: Mapped[Optional[Any]] = mapped_column(Date,   nullable=True)
    warranty_image_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # --- receipt ---
    receipt_image_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # --- QR / label ---
    qr_standard: Mapped[QRCodeStandard] = mapped_column(Enum(QRCodeStandard), default=QRCodeStandard.QR, nullable=False)
    qr_code_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)# base64 PNG or SVG

    # --- custody / status ---
    asset_status: Mapped[AssetStatus] = mapped_column(Enum(AssetStatus), default=AssetStatus.SERVICEABLE, nullable=False)
    current_custodian_id: Mapped[Optional[Any]] = mapped_column(Uuid(as_uuid=True), ForeignKey("inv_users.id"), nullable=True)
    issued_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # --- flags ---
    is_insured: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # --- timestamps ---
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    # --- relationships ---
    home              = relationship("InvHome", back_populates="inventory_items")
    current_custodian = relationship("InvUser", foreign_keys=[current_custodian_id])
    attachments       = relationship("ItemAttachment", back_populates="item", cascade="all, delete-orphan")


class InventoryAudit(Base):  # type: ignore
    """A physical inventory audit session for a home."""
    __tablename__ = "inv_audits"

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    home_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("inv_homes.id"), nullable=False, index=True)
    created_by_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("inv_users.id"), nullable=False)
    status: Mapped[AuditStatus] = mapped_column(Enum(AuditStatus), default=AuditStatus.IN_PROGRESS, nullable=False)
    total_items: Mapped[int] = mapped_column(Integer, default=0, nullable=False)# snapshot at start
    scanned_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    user_timezone: Mapped[str] = mapped_column(String, default="UTC", nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    home       = relationship("InvHome")
    created_by = relationship("InvUser", foreign_keys=[created_by_id])
    scans      = relationship("AuditScan", back_populates="audit", cascade="all, delete-orphan")


class AuditScan(Base):  # type: ignore
    """A single EIN scan recorded during an audit session."""
    __tablename__ = "inv_audit_scans"

    id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    audit_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("inv_audits.id"), nullable=False, index=True)
    item_id: Mapped[Any] = mapped_column(Uuid(as_uuid=True), ForeignKey("inventory_items.id"), nullable=False)
    ein: Mapped[str] = mapped_column(String, nullable=False)
    scanned_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    audit = relationship("InventoryAudit", back_populates="scans")
    item  = relationship("InventoryItem")
