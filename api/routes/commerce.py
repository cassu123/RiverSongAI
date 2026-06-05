"""
api/routes/commerce.py — Commercial Inventory + CRM REST API

Workspaces
  GET  POST  /api/commerce/workspaces
  GET  PATCH DELETE  /api/commerce/workspaces/{workspace_id}
  GET  POST  /api/commerce/workspaces/{workspace_id}/members
  PATCH DELETE  /api/commerce/workspaces/{workspace_id}/members/{user_id}

Products
  GET  POST  /api/commerce/workspaces/{workspace_id}/products
  GET  PATCH DELETE  /api/commerce/products/{product_id}
  POST  /api/commerce/products/{product_id}/stock

Suppliers
  GET  POST  /api/commerce/workspaces/{workspace_id}/suppliers
  PATCH DELETE  /api/commerce/suppliers/{supplier_id}

Customers
  GET  POST  /api/commerce/workspaces/{workspace_id}/customers
  GET  PATCH DELETE  /api/commerce/customers/{customer_id}

Sales
  GET  POST  /api/commerce/workspaces/{workspace_id}/sales
  GET  PATCH  /api/commerce/sales/{sale_id}
"""

from __future__ import annotations

import logging
import os
from typing import Generator, List, Optional

import base64
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session, sessionmaker

from core.auth import decode_token
from core.family import resolve_module_owner
from commercial_inventory.management import (
    PermissionDeniedError,
    WorkspaceNotFoundError,
    LineItemIn,
    add_member,
    adjust_stock,
    create_customer,
    create_product,
    create_sale,
    create_supplier,
    create_workspace,
    delete_customer,
    delete_product,
    delete_supplier,
    delete_workspace,
    edit_workspace,
    get_customer,
    get_customers,
    get_or_create_biz_user,
    get_product,
    get_products,
    get_sale,
    get_sales,
    get_suppliers,
    get_workspace_or_403,
    get_workspaces_for_user,
    list_members,
    remove_member,
    update_customer,
    update_member_role,
    update_product,
    update_sale_status,
    update_supplier,
)
from commercial_inventory.models import (
    Base,
    BizUser,
    BizWorkspace,
    ProductCategory,
    SaleStatus,
    WorkspaceRole,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/commerce", tags=["commerce"])

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

_DB_URL = os.environ.get("COMMERCE_DB_URL", "sqlite:///./data/commerce.db")
_engine = create_engine(
    _DB_URL,
    connect_args={"check_same_thread": False} if "sqlite" in _DB_URL else {},
)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
Base.metadata.create_all(_engine)


def get_db() -> Generator[Session, None, None]:
    db = _Session()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

async def get_current_biz_user(
        request: Request, db: Session = Depends(get_db)) -> BizUser:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(auth.removeprefix("Bearer ").strip())
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = str(payload.get("sub", ""))
    email = payload.get("email", "")
    display_name = payload.get("display_name", "") or email

    if not user_id or not email:
        raise HTTPException(status_code=401,
                            detail="Token missing required fields")

    effective_id = resolve_module_owner(user_id, "store")
    return get_or_create_biz_user(
        db, external_user_id=effective_id, email=email, display_name=display_name)


# ---------------------------------------------------------------------------
# Error helper
# ---------------------------------------------------------------------------

def _http(e: Exception) -> HTTPException:
    if isinstance(e, PermissionDeniedError):
        return HTTPException(status_code=403, detail=str(e))
    if isinstance(e, (WorkspaceNotFoundError, NoResultFound)):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, ValueError):
        return HTTPException(status_code=422, detail=str(e))
    return HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------

def _ser_workspace(ws: BizWorkspace) -> dict:
    return {
        "id": str(ws.id),
        "name": ws.name,
        "description": ws.description,
        "owner_id": str(ws.owner_id),
        "currency": ws.currency,
        "tax_rate": float(ws.tax_rate) if ws.tax_rate else 0.0,
        "product_count": len(ws.products),
        "customer_count": len(ws.customers),
        "created_at": ws.created_at.isoformat() if ws.created_at else None,
        "updated_at": ws.updated_at.isoformat() if ws.updated_at else None,
    }


def _ser_product(p) -> dict:
    return {
        "id": str(p.id),
        "workspace_id": str(p.workspace_id),
        "supplier_id": str(p.supplier_id) if p.supplier_id else None,
        "sku": p.sku,
        "name": p.name,
        "description": p.description,
        "category": p.category.value if p.category else None,
        "stock_qty": p.stock_qty,
        "threshold": p.threshold,
        "unit_price": float(p.unit_price) if p.unit_price else None,
        "cost_price": float(p.cost_price) if p.cost_price else None,
        "shopify_synced": p.shopify_synced,
        "shopify_product_id": p.shopify_product_id,
        "image_data": p.image_data,
        "metadata_json": p.metadata_json,
        "is_active": p.is_active,
        "is_low_stock": p.stock_qty <= p.threshold,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _ser_customer(c) -> dict:
    return {
        "id": str(c.id),
        "workspace_id": str(c.workspace_id),
        "name": c.name,
        "email": c.email,
        "phone": c.phone,
        "address": c.address,
        "notes": c.notes,
        "tags": c.tags,
        "shopify_customer_id": c.shopify_customer_id,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _ser_supplier(s) -> dict:
    return {
        "id": str(s.id),
        "workspace_id": str(s.workspace_id),
        "name": s.name,
        "contact_name": s.contact_name,
        "email": s.email,
        "phone": s.phone,
        "website": s.website,
        "notes": s.notes,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _ser_sale(sale) -> dict:
    return {
        "id": str(sale.id),
        "workspace_id": str(sale.workspace_id),
        "customer_id": str(sale.customer_id) if sale.customer_id else None,
        "created_by_id": str(sale.created_by_id) if sale.created_by_id else None,
        "status": sale.status.value if sale.status else None,
        "total": float(sale.total) if sale.total else None,
        "notes": sale.notes,
        "line_items": [
            {
                "id": str(li.id),
                "product_id": str(li.product_id),
                "qty": li.qty,
                "unit_price": float(li.unit_price),
                "subtotal": float(li.unit_price * li.qty),
            }
            for li in sale.line_items
        ],
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
        "updated_at": sale.updated_at.isoformat() if sale.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class WorkspaceCreate(BaseModel):
    name: str
    description: str = ""
    currency: str = "USD"
    tax_rate: float = 0.0


class WorkspacePatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    currency: Optional[str] = None
    tax_rate: Optional[float] = None


class MemberAdd(BaseModel):
    email: str
    role: WorkspaceRole = WorkspaceRole.VIEWER


class MemberRoleUpdate(BaseModel):
    role: WorkspaceRole


class ProductCreate(BaseModel):
    sku: str
    name: str
    category: ProductCategory = ProductCategory.OTHER
    description: str = ""
    stock_qty: int = 0
    threshold: int = 5
    unit_price: Optional[float] = None
    cost_price: Optional[float] = None
    supplier_id: Optional[str] = None
    metadata_json: Optional[str] = None


class ProductPatch(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    category: Optional[ProductCategory] = None
    description: Optional[str] = None
    threshold: Optional[int] = None
    unit_price: Optional[float] = None
    cost_price: Optional[float] = None
    supplier_id: Optional[str] = None
    metadata_json: Optional[str] = None
    is_active: Optional[bool] = None


class StockAdjust(BaseModel):
    delta: int  # positive = restock, negative = sale/shrinkage


class SupplierCreate(BaseModel):
    name: str
    contact_name: str = ""
    email: str = ""
    phone: str = ""
    website: str = ""
    notes: str = ""


class SupplierPatch(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None


class CustomerCreate(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    address: str = ""
    notes: str = ""
    tags: str = ""


class CustomerPatch(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[str] = None


class SaleLineItemIn(BaseModel):
    product_id: str
    qty: int
    unit_price: Optional[float] = None


class SaleCreate(BaseModel):
    line_items: List[SaleLineItemIn]
    customer_id: Optional[str] = None
    notes: str = ""
    deduct_stock: bool = True


class SaleStatusUpdate(BaseModel):
    status: SaleStatus


# ---------------------------------------------------------------------------
# Workspaces
# ---------------------------------------------------------------------------

@router.get("/workspaces")
def list_workspaces(db: Session = Depends(get_db),
                    user: BizUser = Depends(get_current_biz_user)):
    return [_ser_workspace(ws) for ws in get_workspaces_for_user(db, user)]


@router.post("/workspaces", status_code=201)
def create_workspace_route(
    body: WorkspaceCreate,
    db: Session = Depends(get_db),
    user: BizUser = Depends(get_current_biz_user),
):
    ws = create_workspace(
        db,
        user,
        body.name,
        body.description,
        body.currency,
        body.tax_rate)
    return _ser_workspace(ws)


@router.get("/workspaces/{workspace_id}")
def get_workspace_route(
    workspace_id: str,
    db: Session = Depends(get_db),
    user: BizUser = Depends(get_current_biz_user),
):
    try:
        ws = get_workspace_or_403(db, user, workspace_id)
        return _ser_workspace(ws)
    except Exception as e:
        raise _http(e)


@router.patch("/workspaces/{workspace_id}")
def edit_workspace_route(
    workspace_id: str, body: WorkspacePatch,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        ws = edit_workspace(
            db,
            user,
            workspace_id,
            body.name,
            body.description,
            body.currency,
            body.tax_rate)
        return _ser_workspace(ws)
    except Exception as e:
        raise _http(e)


@router.delete("/workspaces/{workspace_id}", status_code=204)
def delete_workspace_route(
    workspace_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        delete_workspace(db, user, workspace_id)
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------

@router.get("/workspaces/{workspace_id}/members")
def list_members_route(
    workspace_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        return list_members(db, user, workspace_id)
    except Exception as e:
        raise _http(e)


@router.post("/workspaces/{workspace_id}/members", status_code=201)
def add_member_route(
    workspace_id: str, body: MemberAdd,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        add_member(db, user, workspace_id, body.email, body.role)
        return {"status": "added", "email": body.email, "role": body.role.value}
    except Exception as e:
        raise _http(e)


@router.patch("/workspaces/{workspace_id}/members/{member_user_id}")
def update_member_route(
    workspace_id: str, member_user_id: str, body: MemberRoleUpdate,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        update_member_role(db, user, workspace_id, member_user_id, body.role)
        return {"status": "updated", "role": body.role.value}
    except Exception as e:
        raise _http(e)


@router.delete("/workspaces/{workspace_id}/members/{member_user_id}",
               status_code=204)
def remove_member_route(
    workspace_id: str, member_user_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        remove_member(db, user, workspace_id, member_user_id)
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

@router.get("/workspaces/{workspace_id}/products")
def list_products(
    workspace_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        return [_ser_product(p) for p in get_products(db, user, workspace_id)]
    except Exception as e:
        raise _http(e)


@router.post("/workspaces/{workspace_id}/products", status_code=201)
def create_product_route(
    workspace_id: str, body: ProductCreate,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        p = create_product(
            db, user, workspace_id,
            sku=body.sku, name=body.name, category=body.category,
            description=body.description, stock_qty=body.stock_qty,
            threshold=body.threshold, unit_price=body.unit_price,
            cost_price=body.cost_price, supplier_id=body.supplier_id,
            metadata_json=body.metadata_json,
        )
        return _ser_product(p)
    except Exception as e:
        raise _http(e)


@router.get("/products/{product_id}")
def get_product_route(
    product_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        return _ser_product(get_product(db, user, product_id))
    except Exception as e:
        raise _http(e)


@router.patch("/products/{product_id}")
def update_product_route(
    product_id: str, body: ProductPatch,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        return _ser_product(update_product(db, user, product_id, **fields))
    except Exception as e:
        raise _http(e)


@router.delete("/products/{product_id}", status_code=204)
def delete_product_route(
    product_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        delete_product(db, user, product_id)
    except Exception as e:
        raise _http(e)


@router.post("/products/{product_id}/image")
async def upload_product_image(
    product_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: BizUser = Depends(get_current_biz_user),
):
    try:
        allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
        mime = file.content_type or ""
        if mime not in allowed_types:
            raise HTTPException(
                status_code=415,
                detail="Unsupported image type. Use JPEG, PNG, WebP, or GIF.")
        data = await file.read()
        if len(data) > 5 * 1024 * 1024:  # 5 MB limit
            raise HTTPException(
                status_code=413,
                detail="Image must be under 5 MB.")
        p = get_product(db, user, product_id)
        p.image_data = f"data:{mime};base64,{base64.b64encode(data).decode()}"
        db.commit()
        db.refresh(p)
        return _ser_product(p)
    except HTTPException:
        raise
    except Exception as e:
        raise _http(e)


@router.delete("/products/{product_id}/image", status_code=204)
def delete_product_image(
    product_id: str,
    db: Session = Depends(get_db),
    user: BizUser = Depends(get_current_biz_user),
):
    try:
        p = get_product(db, user, product_id)
        p.image_data = None
        db.commit()
    except Exception as e:
        raise _http(e)


@router.post("/products/{product_id}/stock")
def adjust_stock_route(
    product_id: str, body: StockAdjust,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        return _ser_product(adjust_stock(db, user, product_id, body.delta))
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Suppliers
# ---------------------------------------------------------------------------

@router.get("/workspaces/{workspace_id}/suppliers")
def list_suppliers(
    workspace_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        return [_ser_supplier(s)
                for s in get_suppliers(db, user, workspace_id)]
    except Exception as e:
        raise _http(e)


@router.post("/workspaces/{workspace_id}/suppliers", status_code=201)
def create_supplier_route(
    workspace_id: str, body: SupplierCreate,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        s = create_supplier(db, user, workspace_id, body.name, body.contact_name,
                            body.email, body.phone, body.website, body.notes)
        return _ser_supplier(s)
    except Exception as e:
        raise _http(e)


@router.patch("/suppliers/{supplier_id}")
def update_supplier_route(
    supplier_id: str, body: SupplierPatch,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        return _ser_supplier(update_supplier(db, user, supplier_id, **fields))
    except Exception as e:
        raise _http(e)


@router.delete("/suppliers/{supplier_id}", status_code=204)
def delete_supplier_route(
    supplier_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        delete_supplier(db, user, supplier_id)
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------

@router.get("/workspaces/{workspace_id}/customers")
def list_customers(
    workspace_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        return [_ser_customer(c)
                for c in get_customers(db, user, workspace_id)]
    except Exception as e:
        raise _http(e)


@router.post("/workspaces/{workspace_id}/customers", status_code=201)
def create_customer_route(
    workspace_id: str, body: CustomerCreate,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        c = create_customer(db, user, workspace_id, body.name, body.email,
                            body.phone, body.address, body.notes, body.tags)
        return _ser_customer(c)
    except Exception as e:
        raise _http(e)


@router.get("/customers/{customer_id}")
def get_customer_route(
    customer_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        return _ser_customer(get_customer(db, user, customer_id))
    except Exception as e:
        raise _http(e)


@router.patch("/customers/{customer_id}")
def update_customer_route(
    customer_id: str, body: CustomerPatch,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        return _ser_customer(update_customer(db, user, customer_id, **fields))
    except Exception as e:
        raise _http(e)


@router.delete("/customers/{customer_id}", status_code=204)
def delete_customer_route(
    customer_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        delete_customer(db, user, customer_id)
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------

@router.get("/workspaces/{workspace_id}/sales")
def list_sales(
    workspace_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        return [_ser_sale(s) for s in get_sales(db, user, workspace_id)]
    except Exception as e:
        raise _http(e)


@router.post("/workspaces/{workspace_id}/sales", status_code=201)
def create_sale_route(
    workspace_id: str, body: SaleCreate,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        items = [LineItemIn(li.product_id, li.qty, li.unit_price)
                 for li in body.line_items]
        sale = create_sale(
            db,
            user,
            workspace_id,
            items,
            body.customer_id,
            body.notes,
            body.deduct_stock)
        return _ser_sale(sale)
    except Exception as e:
        raise _http(e)


@router.get("/sales/{sale_id}")
def get_sale_route(
    sale_id: str,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        return _ser_sale(get_sale(db, user, sale_id))
    except Exception as e:
        raise _http(e)


@router.patch("/sales/{sale_id}/status")
def update_sale_status_route(
    sale_id: str, body: SaleStatusUpdate,
    db: Session = Depends(get_db), user: BizUser = Depends(get_current_biz_user),
):
    try:
        return _ser_sale(update_sale_status(db, user, sale_id, body.status))
    except Exception as e:
        raise _http(e)
