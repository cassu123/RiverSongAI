import uuid
from datetime import datetime, date

from sqlalchemy import (
    Enum,
    Column,
    String,
    Integer,
    DateTime,
    ForeignKey,
    Table,
    Text, # For description
    Numeric, # For purchase_price and replacement_cost
    Date # For purchase_date
)
from enum import Enum as PyEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


class AssetStatus(PyEnum):
    SERVICEABLE = "Serviceable"
    UNSERVICEABLE = "Unserviceable"
    MISSING = "Missing"
    IN_USE = "In-Use"

# Association table for collaborators, linking Users and Homes in a many-to-many relationship.
collaborators_table = Table(
    "collaborators",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True),
    Column("home_id", UUID(as_uuid=True), ForeignKey("homes.id"), primary_key=True),
    Column("role", Enum(CollaboratorRole), default=CollaboratorRole.VIEWER, nullable=False),
    Column("created_at", DateTime, default=datetime.utcnow),
)


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # A user can own multiple homes.
    homes_owned = relationship("Home", back_populates="owner", cascade="all, delete-orphan")

    # A user can be a collaborator in multiple homes.
    homes_collaborating = relationship(
        "Home", secondary=collaborators_table, back_populates="collaborators"
    )


class Home(Base):
    __tablename__ = "homes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    default_qr_code_standard = Column(Enum(QRCodeStandard), default=QRCodeStandard.STANDARD_QR, nullable=False)

    # A home has one owner.
    owner = relationship("User", back_populates="homes_owned")

    # A home can have many inventory items.
    inventory_items = relationship("InventoryItem", back_populates="home", cascade="all, delete-orphan")

    # A home can have many collaborators.
    collaborators = relationship(
        "User", secondary=collaborators_table, back_populates="homes_collaborating"
    )


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False, index=True)
    quantity = Column(Integer, default=1, nullable=False)
    description = Column(Text)
    home_id = Column(UUID(as_uuid=True), ForeignKey("homes.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # New fields for TCMax-style asset tracking
    asset_status = Column(Enum(AssetStatus), default=AssetStatus.SERVICEABLE, nullable=False)
    current_custodian_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    issued_at = Column(DateTime, nullable=True)

    # New fields for financial tracking and media
    purchase_price = Column(Numeric(10, 2), nullable=True)
    purchase_date = Column(Date, nullable=True)
    replacement_cost = Column(Numeric(10, 2), nullable=True)
    receipt_image_path = Column(String, nullable=True)
    warranty_image_path = Column(String, nullable=True)
    # An inventory item belongs to one home.
    home = relationship("Home", back_populates="inventory_items")
    # Relationship to the User who is the current custodian
    current_custodian = relationship("User", foreign_keys=[current_custodian_id])