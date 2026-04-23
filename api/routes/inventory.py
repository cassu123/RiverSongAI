"""
api/routes/inventory.py — Home Inventory REST API

GET/POST   /api/inventory/homes
PATCH/DEL  /api/inventory/homes/{home_id}
GET/POST   /api/inventory/homes/{home_id}/items
GET/PATCH/DEL /api/inventory/items/{item_id}
GET        /api/inventory/scan/{ein}
POST       /api/inventory/items/{item_id}/receipt
POST       /api/inventory/items/{item_id}/warranty-image
POST       /api/inventory/items/{item_id}/issue
POST       /api/inventory/items/{item_id}/return
GET/POST/PATCH/DEL /api/inventory/homes/{home_id}/collaborators[/{user_id}]
GET        /api/inventory/homes/{home_id}/manifest
"""

from __future__ import annotations

import logging
import os
import uuid as _uuid_mod
from datetime import date
from typing import Generator, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import and_, create_engine
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session, sessionmaker

from core.auth import decode_token
from inventory.auth import HomeNotFoundError, PermissionDeniedError, set_active_home
from inventory.management import (
    create_home,
    create_item,
    delete_item,
    edit_home,
    fast_scan_item,
    generate_insurance_manifest,
    get_homes_for_user,
    get_item,
    get_items_for_home,
    get_or_create_inv_user,
    issue_item,
    manage_collaborators,
    process_receipt,
    return_item,
    update_item,
)
from inventory.models import (
    AssetStatus,
    Base,
    CollaboratorRole,
    InventoryItem,
    InvHome,
    InvUser,
    ItemCategory,
    QRCodeStandard,
    collaborators_table,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/inventory", tags=["inventory"])


def _uid(s) -> _uuid_mod.UUID:
    if isinstance(s, _uuid_mod.UUID):
        return s
    return _uuid_mod.UUID(str(s))

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

_DB_URL = os.environ.get("INVENTORY_DB_URL", "sqlite:///./inventory.db")
_engine  = create_engine(
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
# Auth — pull user from JWT, bootstrap InvUser row
# ---------------------------------------------------------------------------

def get_current_inv_user(request: Request, db: Session = Depends(get_db)) -> InvUser:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = decode_token(auth.removeprefix("Bearer ").strip())
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id      = str(payload.get("sub", ""))
    email        = payload.get("email", "")
    display_name = payload.get("display_name", "") or email

    if not user_id or not email:
        raise HTTPException(status_code=401, detail="Token missing required fields")

    return get_or_create_inv_user(db, external_user_id=user_id, email=email, display_name=display_name)


# ---------------------------------------------------------------------------
# Error helper
# ---------------------------------------------------------------------------

def _http(e: Exception) -> HTTPException:
    if isinstance(e, PermissionDeniedError):
        return HTTPException(status_code=403, detail=str(e))
    if isinstance(e, (HomeNotFoundError, NoResultFound)):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, ValueError):
        return HTTPException(status_code=422, detail=str(e))
    return HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class HomeCreate(BaseModel):
    name: str
    description: str = ""
    qr_standard: QRCodeStandard = QRCodeStandard.QR


class HomePatch(BaseModel):
    name: Optional[str]                   = None
    description: Optional[str]            = None
    qr_standard: Optional[QRCodeStandard] = None


class ItemCreate(BaseModel):
    name: str
    category: ItemCategory                   = ItemCategory.OTHER
    description: str                         = ""
    quantity: int                            = 1
    location: str                            = ""
    manufacturer: str                        = ""
    model_number: str                        = ""
    serial_number: str                       = ""
    purchase_price: Optional[float]          = None
    purchase_date: Optional[date]            = None
    replacement_cost: Optional[float]        = None
    warranty_expiry_date: Optional[date]     = None
    is_insured: bool                         = False
    qr_standard: Optional[QRCodeStandard]   = None


class ItemPatch(BaseModel):
    name: Optional[str]                      = None
    category: Optional[ItemCategory]         = None
    description: Optional[str]              = None
    quantity: Optional[int]                  = None
    location: Optional[str]                  = None
    manufacturer: Optional[str]              = None
    model_number: Optional[str]              = None
    serial_number: Optional[str]             = None
    purchase_price: Optional[float]          = None
    purchase_date: Optional[date]            = None
    replacement_cost: Optional[float]        = None
    warranty_expiry_date: Optional[date]     = None
    is_insured: Optional[bool]               = None
    asset_status: Optional[AssetStatus]      = None
    qr_standard: Optional[QRCodeStandard]   = None


class CollaboratorAdd(BaseModel):
    user_email: str
    role: CollaboratorRole = CollaboratorRole.VIEWER


class CollaboratorRoleUpdate(BaseModel):
    role: CollaboratorRole


class IssueItem(BaseModel):
    collaborator_email: str


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------

def _ser_home(h: InvHome, db: Session) -> dict:
    collab_count = db.execute(
        collaborators_table.select().where(collaborators_table.c.home_id == h.id)
    ).fetchall()
    return {
        "id":                str(h.id),
        "name":              h.name,
        "description":       h.description,
        "owner_id":          str(h.owner_id),
        "qr_standard":       h.default_qr_standard.value if h.default_qr_standard else "qr",
        "collaborator_count": len(collab_count),
        "item_count":        len(h.inventory_items),
        "created_at":        h.created_at.isoformat() if h.created_at else None,
        "updated_at":        h.updated_at.isoformat() if h.updated_at else None,
    }


def _ser_item(i: InventoryItem) -> dict:
    custodian = None
    if i.current_custodian:
        custodian = {"id": str(i.current_custodian.id), "email": i.current_custodian.email}
    return {
        "id":                   str(i.id),
        "ein":                  i.ein,
        "home_id":              str(i.home_id),
        "name":                 i.name,
        "category":             i.category.value if i.category else None,
        "description":          i.description,
        "quantity":             i.quantity,
        "location":             i.location,
        "manufacturer":         i.manufacturer,
        "model_number":         i.model_number,
        "serial_number":        i.serial_number,
        "purchase_price":       float(i.purchase_price)         if i.purchase_price         else None,
        "purchase_date":        i.purchase_date.isoformat()     if i.purchase_date          else None,
        "replacement_cost":     float(i.replacement_cost)       if i.replacement_cost       else None,
        "warranty_expiry_date": i.warranty_expiry_date.isoformat() if i.warranty_expiry_date else None,
        "is_insured":           i.is_insured,
        "asset_status":         i.asset_status.value if i.asset_status else None,
        "current_custodian":    custodian,
        "issued_at":            i.issued_at.isoformat()         if i.issued_at              else None,
        "qr_standard":          i.qr_standard.value if i.qr_standard else None,
        "qr_code_data":         i.qr_code_data,
        "receipt_image_path":   i.receipt_image_path,
        "warranty_image_path":  i.warranty_image_path,
        "created_at":           i.created_at.isoformat()        if i.created_at             else None,
        "updated_at":           i.updated_at.isoformat()        if i.updated_at             else None,
    }


# ---------------------------------------------------------------------------
# Homes
# ---------------------------------------------------------------------------

@router.get("/homes")
def list_homes(db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    homes = get_homes_for_user(db, user)
    return [_ser_home(h, db) for h in homes]


@router.post("/homes", status_code=201)
def create_home_route(body: HomeCreate, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    home = create_home(db, user, body.name, body.description, body.qr_standard)
    return _ser_home(home, db)


@router.patch("/homes/{home_id}")
def edit_home_route(home_id: str, body: HomePatch, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        home = edit_home(db, str(user.id), home_id, body.name, body.description, body.qr_standard)
        return _ser_home(home, db)
    except Exception as e:
        raise _http(e)


@router.delete("/homes/{home_id}", status_code=204)
def delete_home_route(home_id: str, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    home = db.query(InvHome).filter(InvHome.id == _uid(home_id)).first()
    if not home:
        raise HTTPException(status_code=404, detail="Home not found")
    if str(home.owner_id) != str(user.id):
        raise HTTPException(status_code=403, detail="Only the owner can delete a home")
    db.delete(home)
    db.commit()


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------

@router.get("/homes/{home_id}/items")
def list_items(home_id: str, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        return [_ser_item(i) for i in get_items_for_home(db, str(user.id), home_id)]
    except Exception as e:
        raise _http(e)


@router.post("/homes/{home_id}/items", status_code=201)
def create_item_route(home_id: str, body: ItemCreate, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        item = create_item(
            db, str(user.id), home_id,
            name=body.name, category=body.category, description=body.description,
            quantity=body.quantity, location=body.location,
            manufacturer=body.manufacturer, model_number=body.model_number,
            serial_number=body.serial_number, purchase_price=body.purchase_price,
            purchase_date=body.purchase_date, replacement_cost=body.replacement_cost,
            warranty_expiry_date=body.warranty_expiry_date, is_insured=body.is_insured,
            qr_standard=body.qr_standard,
        )
        return _ser_item(item)
    except Exception as e:
        raise _http(e)


@router.get("/items/{item_id}")
def get_item_route(item_id: str, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        return _ser_item(get_item(db, str(user.id), item_id))
    except Exception as e:
        raise _http(e)


@router.patch("/items/{item_id}")
def update_item_route(item_id: str, body: ItemPatch, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        return _ser_item(update_item(db, str(user.id), item_id, **fields))
    except Exception as e:
        raise _http(e)


@router.delete("/items/{item_id}", status_code=204)
def delete_item_route(item_id: str, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        delete_item(db, str(user.id), item_id)
    except Exception as e:
        raise _http(e)


@router.get("/scan/{ein}")
def scan_item(ein: str, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        return _ser_item(fast_scan_item(db, str(user.id), ein))
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Receipt / warranty uploads
# ---------------------------------------------------------------------------

@router.post("/items/{item_id}/receipt")
async def upload_receipt(
    item_id: str,
    file: UploadFile = File(...),
    manual_price: Optional[float] = Form(None),
    manual_date: Optional[date]   = Form(None),
    db: Session = Depends(get_db),
    user: InvUser = Depends(get_current_inv_user),
):
    try:
        data = await file.read()
        item = process_receipt(db, str(user.id), item_id, data, file.filename or "receipt", manual_price, manual_date)
        return _ser_item(item)
    except Exception as e:
        raise _http(e)


@router.post("/items/{item_id}/warranty-image")
async def upload_warranty_image(
    item_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: InvUser = Depends(get_current_inv_user),
):
    from inventory.file_utils import save_file_for_home, INVENTORY_FILES_BASE_DIR
    from inventory.management import _get_item_or_raise
    try:
        item     = _get_item_or_raise(db, item_id)
        set_active_home(db, str(user.id), str(item.home_id))
        data     = await file.read()
        rel_path = save_file_for_home(str(item.home_id), "warranties", data, file.filename or "warranty")
        item.warranty_image_path = rel_path
        db.commit()
        db.refresh(item)
        return _ser_item(item)
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Custody
# ---------------------------------------------------------------------------

@router.post("/items/{item_id}/issue")
def issue_item_route(item_id: str, body: IssueItem, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    collab = db.query(InvUser).filter(InvUser.email == body.collaborator_email).first()
    if not collab:
        raise HTTPException(status_code=404, detail=f"No user with email '{body.collaborator_email}'")
    try:
        return _ser_item(issue_item(db, str(user.id), item_id, str(collab.id)))
    except Exception as e:
        raise _http(e)


@router.post("/items/{item_id}/return")
def return_item_route(item_id: str, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        return _ser_item(return_item(db, str(user.id), item_id))
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Collaborators
# ---------------------------------------------------------------------------

@router.get("/homes/{home_id}/collaborators")
def list_collaborators(home_id: str, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        set_active_home(db, str(user.id), home_id)
        rows = db.execute(
            collaborators_table.select().where(collaborators_table.c.home_id == _uid(home_id))
        ).fetchall()
        result = []
        for row in rows:
            collab = db.query(InvUser).filter(InvUser.id == _uid(row.user_id)).first()
            result.append({
                "user_id": str(row.user_id),
                "email":   collab.email if collab else None,
                "name":    collab.display_name if collab else None,
                "role":    row.role.value if hasattr(row.role, "value") else row.role,
                "since":   row.created_at.isoformat() if row.created_at else None,
            })
        return result
    except Exception as e:
        raise _http(e)


@router.post("/homes/{home_id}/collaborators", status_code=201)
def add_collaborator(home_id: str, body: CollaboratorAdd, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    collab = db.query(InvUser).filter(InvUser.email == body.user_email).first()
    if not collab:
        raise HTTPException(status_code=404, detail=f"No user with email '{body.user_email}'")
    try:
        manage_collaborators(db, str(user.id), home_id, str(collab.id), "add", body.role)
        return {"status": "added", "email": body.user_email, "role": body.role.value}
    except Exception as e:
        raise _http(e)


@router.patch("/homes/{home_id}/collaborators/{collab_user_id}")
def update_collaborator_role(home_id: str, collab_user_id: str, body: CollaboratorRoleUpdate, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        manage_collaborators(db, str(user.id), home_id, collab_user_id, "update_role", body.role)
        return {"status": "updated", "role": body.role.value}
    except Exception as e:
        raise _http(e)


@router.delete("/homes/{home_id}/collaborators/{collab_user_id}", status_code=204)
def remove_collaborator(home_id: str, collab_user_id: str, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        manage_collaborators(db, str(user.id), home_id, collab_user_id, "remove")
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@router.get("/homes/{home_id}/manifest")
def insurance_manifest(home_id: str, db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        pdf_path = generate_insurance_manifest(db, str(user.id), home_id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise _http(e)
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=os.path.basename(pdf_path),
    )
