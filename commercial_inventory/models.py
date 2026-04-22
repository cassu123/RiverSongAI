"""
commercial_inventory/models.py

SQLAlchemy models for the Commercial Inventory + CRM system.

Schema
------
BizUser          — River Song user linked by external_user_id (JWT sub)
BizWorkspace     — A business entity (store, brand, department). One user can own many.
WorkspaceMember  — Grants a BizUser access to a workspace (viewer / editor / admin)
Supplier         — A vendor or supplier linked to a workspace
Product          — A SKU tracked within a workspace; links to an optional supplier
Customer         — A CRM contact linked to a workspace
Sale             — A transaction (stock-out or sale event) within a workspace
SaleLineItem     — One product line within a sale
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


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class WorkspaceRole(PyEnum):
    VIEWER = "viewer"
    EDITOR = "editor"
    ADMIN  = "admin"


class ProductCategory(PyEnum):
    APPAREL      = "Apparel"
    BEAUTY       = "Beauty"
    ELECTRONICS  = "Electronics"
    FOOD         = "Food & Beverage"
    FRAGRANCE    = "Fragrance"
    HEALTH       = "Health"
    HOME_GOODS   = "Home Goods"
    JEWELRY      = "Jewelry"
    SERVICES     = "Services"
    SPORTS       = "Sports & Outdoors"
    TOYS         = "Toys & Games"
    OTHER        = "Other"


class SaleStatus(PyEnum):
    PENDING   = "pending"
    COMPLETED = "completed"
    REFUNDED  = "refunded"
    VOIDED    = "voided"


# ---------------------------------------------------------------------------
# Association table — workspace members
# ---------------------------------------------------------------------------

workspace_members = Table(
    "biz_workspace_members",
    Base.metadata,
    Column("user_id",      Uuid(as_uuid=True), ForeignKey("biz_users.id"),       primary_key=True),
    Column("workspace_id", Uuid(as_uuid=True), ForeignKey("biz_workspaces.id"),  primary_key=True),
    Column("role",         Enum(WorkspaceRole), default=WorkspaceRole.VIEWER, nullable=False),
    Column("joined_at",    DateTime, default=_now),
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class BizUser(Base):
    """River Song user mirrored into the commercial system."""
    __tablename__ = "biz_users"

    id               = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_user_id = Column(String, unique=True, nullable=False, index=True)
    email            = Column(String, unique=True, nullable=False, index=True)
    display_name     = Column(String, nullable=True)
    created_at       = Column(DateTime, default=_now)

    workspaces_owned       = relationship("BizWorkspace", back_populates="owner", cascade="all, delete-orphan")
    workspaces_membered    = relationship(
        "BizWorkspace", secondary=workspace_members, back_populates="members"
    )


class BizWorkspace(Base):
    """A business entity — a store, brand, or department."""
    __tablename__ = "biz_workspaces"

    id          = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name        = Column(String, nullable=False)
    description = Column(Text,   nullable=True)
    owner_id    = Column(Uuid(as_uuid=True), ForeignKey("biz_users.id"), nullable=False)
    currency    = Column(String(3), default="USD", nullable=False)
    tax_rate    = Column(Numeric(5, 4), default=0, nullable=False)  # e.g. 0.0875 = 8.75 %
    created_at  = Column(DateTime, default=_now)
    updated_at  = Column(DateTime, default=_now, onupdate=_now)

    owner     = relationship("BizUser", back_populates="workspaces_owned")
    members   = relationship("BizUser", secondary=workspace_members, back_populates="workspaces_membered")
    products  = relationship("Product",  back_populates="workspace", cascade="all, delete-orphan")
    suppliers = relationship("Supplier", back_populates="workspace", cascade="all, delete-orphan")
    customers = relationship("Customer", back_populates="workspace", cascade="all, delete-orphan")
    sales     = relationship("Sale",     back_populates="workspace", cascade="all, delete-orphan")


class Supplier(Base):
    """A vendor or supplier that provides products to a workspace."""
    __tablename__ = "biz_suppliers"

    id           = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(Uuid(as_uuid=True), ForeignKey("biz_workspaces.id"), nullable=False)
    name         = Column(String, nullable=False)
    contact_name = Column(String, nullable=True)
    email        = Column(String, nullable=True)
    phone        = Column(String, nullable=True)
    website      = Column(String, nullable=True)
    notes        = Column(Text,   nullable=True)
    created_at   = Column(DateTime, default=_now)
    updated_at   = Column(DateTime, default=_now, onupdate=_now)

    workspace = relationship("BizWorkspace", back_populates="suppliers")
    products  = relationship("Product", back_populates="supplier")


class Product(Base):
    """
    A SKU tracked within a workspace.

    stock_qty    — current on-hand units
    threshold    — low-stock alert fires when stock_qty <= threshold
    """
    __tablename__ = "biz_products"

    id               = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id     = Column(Uuid(as_uuid=True), ForeignKey("biz_workspaces.id"), nullable=False)
    supplier_id      = Column(Uuid(as_uuid=True), ForeignKey("biz_suppliers.id"),  nullable=True)
    sku              = Column(String, nullable=False, index=True)
    name             = Column(String, nullable=False, index=True)
    description      = Column(Text,   nullable=True)
    category         = Column(Enum(ProductCategory), default=ProductCategory.OTHER, nullable=False)
    stock_qty        = Column(Integer, default=0,  nullable=False)
    threshold        = Column(Integer, default=5,  nullable=False)
    unit_price       = Column(Numeric(10, 2), nullable=True)
    cost_price       = Column(Numeric(10, 2), nullable=True)
    shopify_synced   = Column(Boolean, default=False, nullable=False)
    shopify_product_id = Column(String, nullable=True)
    image_data       = Column(Text, nullable=True)   # base64 data URL (data:image/...;base64,...)
    metadata_json    = Column(Text, nullable=True)   # freeform JSON for category-specific fields
    is_active        = Column(Boolean, default=True, nullable=False)
    created_at       = Column(DateTime, default=_now)
    updated_at       = Column(DateTime, default=_now, onupdate=_now)

    workspace      = relationship("BizWorkspace", back_populates="products")
    supplier       = relationship("Supplier",     back_populates="products")
    sale_line_items = relationship("SaleLineItem", back_populates="product")


class Customer(Base):
    """A CRM contact associated with a workspace."""
    __tablename__ = "biz_customers"

    id           = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(Uuid(as_uuid=True), ForeignKey("biz_workspaces.id"), nullable=False)
    name         = Column(String, nullable=False, index=True)
    email        = Column(String, nullable=True,  index=True)
    phone        = Column(String, nullable=True)
    address      = Column(Text,   nullable=True)
    notes        = Column(Text,   nullable=True)
    tags         = Column(String, nullable=True)  # comma-separated
    shopify_customer_id = Column(String, nullable=True)
    created_at   = Column(DateTime, default=_now)
    updated_at   = Column(DateTime, default=_now, onupdate=_now)

    workspace = relationship("BizWorkspace", back_populates="customers")
    sales     = relationship("Sale",         back_populates="customer")


class Sale(Base):
    """
    A transaction within a workspace.

    status      — pending / completed / refunded / voided
    customer_id — nullable (guest checkout)
    total       — sum of (line_item.qty * unit_price) — stored for reporting
    """
    __tablename__ = "biz_sales"

    id              = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id    = Column(Uuid(as_uuid=True), ForeignKey("biz_workspaces.id"), nullable=False)
    customer_id     = Column(Uuid(as_uuid=True), ForeignKey("biz_customers.id"),  nullable=True)
    created_by_id   = Column(Uuid(as_uuid=True), ForeignKey("biz_users.id"),      nullable=True)
    status          = Column(Enum(SaleStatus), default=SaleStatus.PENDING, nullable=False)
    total           = Column(Numeric(10, 2), nullable=True)
    notes           = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=_now)
    updated_at      = Column(DateTime, default=_now, onupdate=_now)

    workspace  = relationship("BizWorkspace", back_populates="sales")
    customer   = relationship("Customer",     back_populates="sales")
    created_by = relationship("BizUser",      foreign_keys=[created_by_id])
    line_items = relationship("SaleLineItem", back_populates="sale", cascade="all, delete-orphan")


class SaleLineItem(Base):
    """One product entry within a sale."""
    __tablename__ = "biz_sale_line_items"

    id          = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sale_id     = Column(Uuid(as_uuid=True), ForeignKey("biz_sales.id"),    nullable=False)
    product_id  = Column(Uuid(as_uuid=True), ForeignKey("biz_products.id"), nullable=False)
    qty         = Column(Integer,         nullable=False, default=1)
    unit_price  = Column(Numeric(10, 2),  nullable=False)

    sale    = relationship("Sale",    back_populates="line_items")
    product = relationship("Product", back_populates="sale_line_items")
