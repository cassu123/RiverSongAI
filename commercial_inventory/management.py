"""
commercial_inventory/management.py

Business-logic layer for the Commercial Inventory + CRM system.
All DB writes go through here; API routes stay thin.

Functions
---------
Workspace
  get_or_create_biz_user
  create_workspace / get_workspaces_for_user / edit_workspace / delete_workspace
  get_workspace_or_403

Members
  add_member / remove_member / update_member_role / list_members

Products
  create_product / get_products / get_product / update_product / delete_product
  adjust_stock        — atomic stock increment / decrement

Suppliers
  create_supplier / get_suppliers / update_supplier / delete_supplier

Customers
  create_customer / get_customers / get_customer / update_customer / delete_customer

Sales
  create_sale         — creates Sale + SaleLineItems, decrements stock
  get_sales / get_sale
  update_sale_status
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session

from .models import (
    BizUser,
    BizWorkspace,
    Customer,
    Product,
    ProductCategory,
    Sale,
    SaleLineItem,
    SaleStatus,
    Supplier,
    WorkspaceRole,
    workspace_members,
)

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class WorkspaceNotFoundError(Exception):
    pass

class PermissionDeniedError(Exception):
    pass


# ---------------------------------------------------------------------------
# User bootstrap
# ---------------------------------------------------------------------------

def get_or_create_biz_user(
    db: Session, external_user_id: str, email: str, display_name: str = ""
) -> BizUser:
    user = (
        db.query(BizUser)
        .filter(
            (BizUser.external_user_id == external_user_id) |
            (BizUser.email == email)
        )
        .first()
    )
    if user:
        # Keep external_user_id in sync if it changed (e.g. re-registered)
        if user.external_user_id != external_user_id:
            user.external_user_id = external_user_id
            db.commit()
        return user
    try:
        user = BizUser(
            external_user_id=external_user_id,
            email=email,
            display_name=display_name or email,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    except Exception:
        db.rollback()
        # Another request beat us to it — fetch the now-existing row
        user = db.query(BizUser).filter(BizUser.email == email).first()
        if user:
            return user
        raise


# ---------------------------------------------------------------------------
# Workspace access helpers
# ---------------------------------------------------------------------------

def get_workspace_or_403(
    db: Session, user: BizUser, workspace_id: str, min_role: WorkspaceRole = WorkspaceRole.VIEWER
) -> BizWorkspace:
    ws = db.query(BizWorkspace).filter(BizWorkspace.id == workspace_id).first()
    if not ws:
        raise WorkspaceNotFoundError(f"Workspace '{workspace_id}' not found.")

    if str(ws.owner_id) == str(user.id):
        return ws  # owner always has full access

    row = db.execute(
        workspace_members.select().where(
            (workspace_members.c.workspace_id == workspace_id) &
            (workspace_members.c.user_id == user.id)
        )
    ).first()

    if not row:
        raise PermissionDeniedError("You are not a member of this workspace.")

    role_order = [WorkspaceRole.VIEWER, WorkspaceRole.EDITOR, WorkspaceRole.ADMIN]
    if role_order.index(row.role) < role_order.index(min_role):
        raise PermissionDeniedError(
            f"This action requires at least '{min_role.value}' role."
        )
    return ws


# ---------------------------------------------------------------------------
# Workspaces
# ---------------------------------------------------------------------------

def create_workspace(
    db: Session,
    owner: BizUser,
    name: str,
    description: str = "",
    currency: str = "USD",
    tax_rate: float = 0.0,
) -> BizWorkspace:
    ws = BizWorkspace(
        owner_id=owner.id,
        name=name,
        description=description,
        currency=currency,
        tax_rate=Decimal(str(tax_rate)),
    )
    db.add(ws)
    db.commit()
    db.refresh(ws)
    logger.info("Workspace created: %s (owner=%s)", ws.id, owner.id)
    return ws


def get_workspaces_for_user(db: Session, user: BizUser) -> list[BizWorkspace]:
    owned = db.query(BizWorkspace).filter(BizWorkspace.owner_id == user.id).all()
    membered = user.workspaces_membered
    seen = {ws.id for ws in owned}
    return owned + [ws for ws in membered if ws.id not in seen]


def edit_workspace(
    db: Session,
    user: BizUser,
    workspace_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    currency: Optional[str] = None,
    tax_rate: Optional[float] = None,
) -> BizWorkspace:
    ws = get_workspace_or_403(db, user, workspace_id, min_role=WorkspaceRole.ADMIN)
    if str(ws.owner_id) != str(user.id):
        raise PermissionDeniedError("Only the workspace owner can edit workspace settings.")
    if name        is not None: ws.name        = name
    if description is not None: ws.description = description
    if currency    is not None: ws.currency    = currency
    if tax_rate    is not None: ws.tax_rate    = Decimal(str(tax_rate))
    db.commit()
    db.refresh(ws)
    return ws


def delete_workspace(db: Session, user: BizUser, workspace_id: str) -> None:
    ws = db.query(BizWorkspace).filter(BizWorkspace.id == workspace_id).first()
    if not ws:
        raise WorkspaceNotFoundError(f"Workspace '{workspace_id}' not found.")
    if str(ws.owner_id) != str(user.id):
        raise PermissionDeniedError("Only the workspace owner can delete a workspace.")
    db.delete(ws)
    db.commit()


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------

def add_member(
    db: Session,
    owner: BizUser,
    workspace_id: str,
    member_email: str,
    role: WorkspaceRole = WorkspaceRole.VIEWER,
) -> None:
    ws = get_workspace_or_403(db, owner, workspace_id, min_role=WorkspaceRole.ADMIN)
    if str(ws.owner_id) != str(owner.id):
        raise PermissionDeniedError("Only the workspace owner can manage members.")

    member = db.query(BizUser).filter(BizUser.email == member_email).first()
    if not member:
        raise NoResultFound(f"No user with email '{member_email}'.")
    if str(member.id) == str(owner.id):
        raise ValueError("Cannot add the owner as a member.")

    existing = db.execute(
        workspace_members.select().where(
            (workspace_members.c.workspace_id == workspace_id) &
            (workspace_members.c.user_id == member.id)
        )
    ).first()
    if existing:
        raise ValueError(f"'{member_email}' is already a member.")

    db.execute(workspace_members.insert().values(
        user_id=member.id, workspace_id=workspace_id, role=role, joined_at=_now()
    ))
    db.commit()


def remove_member(
    db: Session, owner: BizUser, workspace_id: str, member_user_id: str
) -> None:
    ws = get_workspace_or_403(db, owner, workspace_id, min_role=WorkspaceRole.ADMIN)
    if str(ws.owner_id) != str(owner.id):
        raise PermissionDeniedError("Only the workspace owner can manage members.")
    result = db.execute(workspace_members.delete().where(
        (workspace_members.c.workspace_id == workspace_id) &
        (workspace_members.c.user_id == member_user_id)
    ))
    if result.rowcount == 0:  # type: ignore
        raise NoResultFound("Member not found in workspace.")
    db.commit()


def update_member_role(
    db: Session, owner: BizUser, workspace_id: str, member_user_id: str, role: WorkspaceRole
) -> None:
    get_workspace_or_403(db, owner, workspace_id, min_role=WorkspaceRole.ADMIN)
    result = db.execute(workspace_members.update().where(
        (workspace_members.c.workspace_id == workspace_id) &
        (workspace_members.c.user_id == member_user_id)
    ).values(role=role))
    if result.rowcount == 0:  # type: ignore
        raise NoResultFound("Member not found in workspace.")
    db.commit()


def list_members(db: Session, user: BizUser, workspace_id: str) -> list[dict]:
    get_workspace_or_403(db, user, workspace_id)
    rows = db.execute(
        workspace_members.select().where(workspace_members.c.workspace_id == workspace_id)
    ).fetchall()
    result = []
    for row in rows:
        member = db.query(BizUser).filter(BizUser.id == row.user_id).first()
        result.append({
            "user_id":  str(row.user_id),
            "email":    member.email if member else None,
            "name":     member.display_name if member else None,
            "role":     row.role.value,
            "since":    row.joined_at.isoformat() if row.joined_at else None,
        })
    return result


# ---------------------------------------------------------------------------
# Suppliers
# ---------------------------------------------------------------------------

def create_supplier(
    db: Session, user: BizUser, workspace_id: str,
    name: str, contact_name: str = "", email: str = "",
    phone: str = "", website: str = "", notes: str = "",
) -> Supplier:
    get_workspace_or_403(db, user, workspace_id, min_role=WorkspaceRole.EDITOR)
    s = Supplier(
        workspace_id=workspace_id, name=name, contact_name=contact_name,
        email=email, phone=phone, website=website, notes=notes,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def get_suppliers(db: Session, user: BizUser, workspace_id: str) -> list[Supplier]:
    get_workspace_or_403(db, user, workspace_id)
    return db.query(Supplier).filter(Supplier.workspace_id == workspace_id).order_by(Supplier.name).all()


def update_supplier(db: Session, user: BizUser, supplier_id: str, **fields) -> Supplier:
    s = _get_or_raise(db, Supplier, supplier_id, "Supplier")
    get_workspace_or_403(db, user, str(s.workspace_id), min_role=WorkspaceRole.EDITOR)
    for k, v in fields.items():
        if v is not None:
            setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s


def delete_supplier(db: Session, user: BizUser, supplier_id: str) -> None:
    s = _get_or_raise(db, Supplier, supplier_id, "Supplier")
    get_workspace_or_403(db, user, str(s.workspace_id), min_role=WorkspaceRole.EDITOR)
    db.delete(s)
    db.commit()


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

def create_product(
    db: Session, user: BizUser, workspace_id: str,
    sku: str, name: str,
    category: ProductCategory = ProductCategory.OTHER,
    description: str = "",
    stock_qty: int = 0,
    threshold: int = 5,
    unit_price: Optional[float] = None,
    cost_price: Optional[float] = None,
    supplier_id: Optional[str] = None,
    metadata_json: Optional[str] = None,
) -> Product:
    get_workspace_or_403(db, user, workspace_id, min_role=WorkspaceRole.EDITOR)
    p = Product(
        workspace_id=workspace_id,
        sku=sku,
        name=name,
        category=category,
        description=description,
        stock_qty=stock_qty,
        threshold=threshold,
        unit_price=Decimal(str(unit_price)) if unit_price is not None else None,
        cost_price=Decimal(str(cost_price)) if cost_price is not None else None,
        supplier_id=supplier_id,
        metadata_json=metadata_json,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def get_products(db: Session, user: BizUser, workspace_id: str) -> list[Product]:
    get_workspace_or_403(db, user, workspace_id)
    return (
        db.query(Product)
        .filter(Product.workspace_id == workspace_id)
        .order_by(Product.name)
        .all()
    )


def get_product(db: Session, user: BizUser, product_id: str) -> Product:
    p = _get_or_raise(db, Product, product_id, "Product")
    get_workspace_or_403(db, user, str(p.workspace_id))
    return p


def update_product(db: Session, user: BizUser, product_id: str, **fields) -> Product:
    p = _get_or_raise(db, Product, product_id, "Product")
    get_workspace_or_403(db, user, str(p.workspace_id), min_role=WorkspaceRole.EDITOR)
    numeric = {"unit_price", "cost_price"}
    for k, v in fields.items():
        if v is None:
            continue
        if k in numeric:
            v = Decimal(str(v))
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


def adjust_stock(
    db: Session, user: BizUser, product_id: str, delta: int
) -> Product:
    """Atomically change stock by delta (positive = restock, negative = sale)."""
    p = _get_or_raise(db, Product, product_id, "Product")
    get_workspace_or_403(db, user, str(p.workspace_id), min_role=WorkspaceRole.EDITOR)
    new_qty = p.stock_qty + delta
    if new_qty < 0:
        raise ValueError(f"Insufficient stock: have {p.stock_qty}, requested {-delta}.")
    p.stock_qty = new_qty
    db.commit()
    db.refresh(p)
    return p


def delete_product(db: Session, user: BizUser, product_id: str) -> None:
    p = _get_or_raise(db, Product, product_id, "Product")
    get_workspace_or_403(db, user, str(p.workspace_id), min_role=WorkspaceRole.EDITOR)
    db.delete(p)
    db.commit()


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------

def create_customer(
    db: Session, user: BizUser, workspace_id: str,
    name: str, email: str = "", phone: str = "",
    address: str = "", notes: str = "", tags: str = "",
) -> Customer:
    get_workspace_or_403(db, user, workspace_id, min_role=WorkspaceRole.EDITOR)
    c = Customer(
        workspace_id=workspace_id, name=name, email=email,
        phone=phone, address=address, notes=notes, tags=tags,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def get_customers(db: Session, user: BizUser, workspace_id: str) -> list[Customer]:
    get_workspace_or_403(db, user, workspace_id)
    return (
        db.query(Customer)
        .filter(Customer.workspace_id == workspace_id)
        .order_by(Customer.name)
        .all()
    )


def get_customer(db: Session, user: BizUser, customer_id: str) -> Customer:
    c = _get_or_raise(db, Customer, customer_id, "Customer")
    get_workspace_or_403(db, user, str(c.workspace_id))
    return c


def update_customer(db: Session, user: BizUser, customer_id: str, **fields) -> Customer:
    c = _get_or_raise(db, Customer, customer_id, "Customer")
    get_workspace_or_403(db, user, str(c.workspace_id), min_role=WorkspaceRole.EDITOR)
    for k, v in fields.items():
        if v is not None:
            setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return c


def delete_customer(db: Session, user: BizUser, customer_id: str) -> None:
    c = _get_or_raise(db, Customer, customer_id, "Customer")
    get_workspace_or_403(db, user, str(c.workspace_id), min_role=WorkspaceRole.EDITOR)
    db.delete(c)
    db.commit()


# ---------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------

class LineItemIn:
    """Input DTO for a single line item when creating a sale."""
    def __init__(self, product_id: str, qty: int, unit_price: Optional[float] = None):
        self.product_id = product_id
        self.qty        = qty
        self.unit_price = unit_price  # override if provided, else use product.unit_price


def create_sale(
    db: Session,
    user: BizUser,
    workspace_id: str,
    line_items: list[LineItemIn],
    customer_id: Optional[str] = None,
    notes: str = "",
    deduct_stock: bool = True,
) -> Sale:
    get_workspace_or_403(db, user, workspace_id, min_role=WorkspaceRole.EDITOR)

    sale = Sale(
        workspace_id=workspace_id,
        customer_id=customer_id,
        created_by_id=user.id,
        status=SaleStatus.PENDING,
        notes=notes,
    )
    db.add(sale)
    db.flush()  # get sale.id without committing

    total = Decimal("0")
    for li in line_items:
        product = _get_or_raise(db, Product, li.product_id, "Product")
        price = Decimal(str(li.unit_price)) if li.unit_price is not None else (product.unit_price or Decimal("0"))
        if deduct_stock:
            if product.stock_qty < li.qty:
                db.rollback()
                raise ValueError(f"Insufficient stock for '{product.name}': have {product.stock_qty}, need {li.qty}.")
            product.stock_qty -= li.qty
        db.add(SaleLineItem(sale_id=sale.id, product_id=product.id, qty=li.qty, unit_price=price))
        total += price * li.qty

    sale.total  = total
    sale.status = SaleStatus.COMPLETED
    db.commit()
    db.refresh(sale)
    logger.info("Sale created: %s, total=%s, workspace=%s", sale.id, total, workspace_id)
    return sale


def get_sales(db: Session, user: BizUser, workspace_id: str) -> list[Sale]:
    get_workspace_or_403(db, user, workspace_id)
    return (
        db.query(Sale)
        .filter(Sale.workspace_id == workspace_id)
        .order_by(Sale.created_at.desc())
        .all()
    )


def get_sale(db: Session, user: BizUser, sale_id: str) -> Sale:
    sale = _get_or_raise(db, Sale, sale_id, "Sale")
    get_workspace_or_403(db, user, str(sale.workspace_id))
    return sale


def update_sale_status(
    db: Session, user: BizUser, sale_id: str, status: SaleStatus
) -> Sale:
    sale = _get_or_raise(db, Sale, sale_id, "Sale")
    get_workspace_or_403(db, user, str(sale.workspace_id), min_role=WorkspaceRole.EDITOR)
    sale.status = status
    db.commit()
    db.refresh(sale)
    return sale


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

def _get_or_raise(db: Session, model, record_id: str, label: str):
    obj = db.query(model).filter(model.id == record_id).first()
    if not obj:
        raise NoResultFound(f"{label} '{record_id}' not found.")
    return obj
