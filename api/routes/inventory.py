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

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session, sessionmaker

from core.auth import decode_token
from core.errors import bad_request, forbidden, not_found, unauthorized
from core.family import resolve_module_owner
from inventory.auth import HomeNotFoundError, PermissionDeniedError, set_active_home
from inventory.management import (
    add_attachment,
    complete_audit,
    create_home,
    create_item,
    delete_attachment,
    delete_item,
    edit_home,
    fast_scan_item,
    generate_insurance_manifest,
    generate_audit_discrepancy_report,
    get_attachments,
    get_active_audit,
    get_audit_history,
    get_homes_for_user,
    get_item,
    get_items_for_home,
    get_or_create_inv_user,
    manage_collaborators,
    process_receipt,
    reassign_items_to_home,
    record_scan,
    start_audit,
    update_item,
)
from inventory.models import (
    AssetStatus,
    AuditScan,
    Base,
    CollaboratorRole,
    InventoryAudit,
    InventoryItem,
    ItemAttachment,
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


_DB_URL = os.environ.get("INVENTORY_DB_URL", "sqlite:///./data/inventory.db")
_engine = create_engine(
    _DB_URL,
    connect_args={"check_same_thread": False} if "sqlite" in _DB_URL else {},
)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
Base.metadata.create_all(_engine)
with _engine.begin() as conn:
    try:
        conn.execute(text("ALTER TABLE inv_item_attachments ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT 0"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE inventory_items ADD COLUMN label_printed_at DATETIME"))
    except Exception:
        pass


def get_db() -> Generator[Session, None, None]:
    db = _Session()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Auth — pull user from JWT, bootstrap InvUser row
# ---------------------------------------------------------------------------

async def get_current_inv_user(
        request: Request, db: Session = Depends(get_db)) -> InvUser:
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if not token:
        token = request.query_params.get("token", "").strip()
    if not token:
        raise unauthorized("Missing Bearer token")
    payload = await decode_token(token)
    if not payload:
        raise unauthorized("Invalid or expired token")

    user_id = str(payload.get("sub", ""))
    email = payload.get("email", "")
    display_name = payload.get("display_name", "") or email

    if not user_id or not email:
        raise unauthorized("Token missing required fields")

    effective_id = resolve_module_owner(user_id, "inventory")
    return get_or_create_inv_user(
        db, external_user_id=effective_id, email=email, display_name=display_name)


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
    name: Optional[str] = None
    description: Optional[str] = None
    qr_standard: Optional[QRCodeStandard] = None

class ReassignHome(BaseModel):
    target_home_id: str
    item_ids: Optional[list[str]] = None


class ItemCreate(BaseModel):
    name: str
    category: ItemCategory = ItemCategory.OTHER
    description: str = ""
    quantity: int = 1
    location: str = ""
    manufacturer: str = ""
    model_number: str = ""
    serial_number: str = ""
    purchase_price: Optional[float] = None
    purchase_date: Optional[date] = None
    replacement_cost: Optional[float] = None
    warranty_expiry_date: Optional[date] = None
    is_insured: bool = False
    qr_standard: Optional[QRCodeStandard] = None


class ItemPatch(BaseModel):
    name: Optional[str] = None
    category: Optional[ItemCategory] = None
    description: Optional[str] = None
    quantity: Optional[int] = None
    location: Optional[str] = None
    manufacturer: Optional[str] = None
    model_number: Optional[str] = None
    serial_number: Optional[str] = None
    purchase_price: Optional[float] = None
    purchase_date: Optional[date] = None
    replacement_cost: Optional[float] = None
    warranty_expiry_date: Optional[date] = None
    is_insured: Optional[bool] = None
    asset_status: Optional[AssetStatus] = None
    qr_standard: Optional[QRCodeStandard] = None


class CollaboratorAdd(BaseModel):
    user_email: str
    role: CollaboratorRole = CollaboratorRole.VIEWER


class CollaboratorRoleUpdate(BaseModel):
    role: CollaboratorRole





class AuditScanBody(BaseModel):
    ein: str


class AuditCompleteBody(BaseModel):
    notes: str = ""


class TimezoneUpdate(BaseModel):
    timezone: str


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------

def _ser_home(h: InvHome, db: Session) -> dict:
    collab_count = db.execute(
        collaborators_table.select().where(collaborators_table.c.home_id == h.id)
    ).fetchall()
    return {
        "id": str(h.id),
        "name": h.name,
        "description": h.description,
        "owner_id": str(h.owner_id),
        "qr_standard": h.default_qr_standard.value if h.default_qr_standard else "qr",
        "collaborator_count": len(collab_count),
        "item_count": len(h.inventory_items),
        "created_at": h.created_at.isoformat() if h.created_at else None,
        "updated_at": h.updated_at.isoformat() if h.updated_at else None,
    }


def _ser_item(i: InventoryItem) -> dict:
    return {
        "id": str(i.id),
        "ein": i.ein,
        "home_id": str(i.home_id),
        "name": i.name,
        "category": i.category.value if i.category else None,
        "description": i.description,
        "quantity": i.quantity,
        "location": i.location,
        "manufacturer": i.manufacturer,
        "model_number": i.model_number,
        "serial_number": i.serial_number,
        "purchase_price": float(i.purchase_price) if i.purchase_price else None,
        "purchase_date": i.purchase_date.isoformat() if i.purchase_date else None,
        "replacement_cost": float(i.replacement_cost) if i.replacement_cost else None,
        "warranty_expiry_date": i.warranty_expiry_date.isoformat() if i.warranty_expiry_date else None,
        "is_insured": i.is_insured,
        "asset_status": i.asset_status.value if i.asset_status else None,
        "qr_standard": i.qr_standard.value if i.qr_standard else None,
        "qr_code_data": i.qr_code_data,
        "receipt_image_path": i.receipt_image_path,
        "warranty_image_path": i.warranty_image_path,
        "created_at": i.created_at.isoformat() if i.created_at else None,
        "updated_at": i.updated_at.isoformat() if i.updated_at else None,
    }


def _ser_attachment(a: ItemAttachment) -> dict:
    return {
        "id": str(a.id),
        "item_id": str(a.item_id),
        "original_filename": a.original_filename,
        "file_size": a.file_size,
        "mime_type": a.mime_type,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


# ---------------------------------------------------------------------------
# Homes
# ---------------------------------------------------------------------------

@router.get("/homes")
def list_homes(db: Session = Depends(get_db),
               user: InvUser = Depends(get_current_inv_user)):
    homes = get_homes_for_user(db, user)
    return [_ser_home(h, db) for h in homes]


@router.post("/homes", status_code=201)
def create_home_route(body: HomeCreate, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    home = create_home(db, user, body.name, body.description, body.qr_standard)
    return _ser_home(home, db)


@router.patch("/homes/{home_id}")
def edit_home_route(home_id: str, body: HomePatch, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        home = edit_home(db, str(user.id), home_id, body.name,
                         body.description, body.qr_standard)
        return _ser_home(home, db)
    except Exception as e:
        raise _http(e)


@router.delete("/homes/{home_id}", status_code=204)
def delete_home_route(home_id: str, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    home = db.query(InvHome).filter(InvHome.id == _uid(home_id)).first()
    if not home:
        raise not_found("Home not found")
    if str(home.owner_id) != str(user.id):
        raise forbidden("Only the owner can delete a home")
    db.delete(home)
    db.commit()


@router.post("/homes/{home_id}/reassign")
def reassign_home_route(home_id: str, body: ReassignHome, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        count = reassign_items_to_home(db, str(user.id), home_id, body.target_home_id, body.item_ids)
        return {"reassigned_count": count}
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------

@router.get("/homes/{home_id}/items")
def list_items(home_id: str, db: Session = Depends(get_db),
               user: InvUser = Depends(get_current_inv_user)):
    try:
        return [_ser_item(i)
                for i in get_items_for_home(db, str(user.id), home_id)]
    except Exception as e:
        raise _http(e)


@router.post("/homes/{home_id}/items", status_code=201)
def create_item_route(home_id: str, body: ItemCreate, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
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
def get_item_route(item_id: str, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        return _ser_item(get_item(db, str(user.id), item_id))
    except Exception as e:
        raise _http(e)


@router.patch("/items/{item_id}")
def update_item_route(item_id: str, body: ItemPatch, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        return _ser_item(update_item(db, str(user.id), item_id, **fields))
    except Exception as e:
        raise _http(e)


@router.delete("/items/{item_id}", status_code=204)
def delete_item_route(item_id: str, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        delete_item(db, str(user.id), item_id)
    except Exception as e:
        raise _http(e)


@router.get("/scan/{ein}")
def scan_item(ein: str, db: Session = Depends(get_db),
              user: InvUser = Depends(get_current_inv_user)):
    try:
        return _ser_item(fast_scan_item(db, str(user.id), ein))
    except Exception as e:
        raise _http(e)


def _ser_audit(a: InventoryAudit, db: Session) -> dict:
    scanned_ids = {
        s.item_id for s in db.query(AuditScan).filter(
            AuditScan.audit_id == a.id).all()}
    all_items = db.query(InventoryItem).filter(
        InventoryItem.home_id == a.home_id).all()
    scanned = [{"id": str(i.id), "ein": i.ein, "name": i.name, "location": i.location}
               for i in all_items if i.id in scanned_ids]
    missing = [{"id": str(i.id), "ein": i.ein, "name": i.name, "location": i.location}
               for i in all_items if i.id not in scanned_ids]
    return {
        "id": str(a.id),
        "home_id": str(a.home_id),
        "status": a.status.value,
        "total_items": a.total_items,
        "scanned_count": len(scanned),
        "scanned": scanned,
        "missing": missing,
        "notes": a.notes,
        "user_timezone": a.user_timezone,
        "started_at": a.started_at.isoformat() if a.started_at else None,
        "completed_at": a.completed_at.isoformat() if a.completed_at else None,
    }


# ---------------------------------------------------------------------------
# Timezone
# ---------------------------------------------------------------------------

@router.patch("/users/timezone")
def update_timezone(body: TimezoneUpdate, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    import zoneinfo
    try:
        zoneinfo.ZoneInfo(body.timezone)
    except Exception:
        raise bad_request(f"Unknown timezone '{body.timezone}'")
    user.timezone = body.timezone
    db.commit()
    return {"timezone": user.timezone}


@router.get("/users/me")
def get_me(db: Session = Depends(get_db),
           user: InvUser = Depends(get_current_inv_user)):
    return {"id": str(user.id), "email": user.email,
            "display_name": user.display_name, "timezone": user.timezone}


# ---------------------------------------------------------------------------
# Audits
# ---------------------------------------------------------------------------

@router.get("/homes/{home_id}/audit/active")
def get_active_audit_route(home_id: str, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        audit = get_active_audit(db, str(user.id), home_id)
        if not audit:
            return None
        return _ser_audit(audit, db)
    except Exception as e:
        raise _http(e)


@router.post("/homes/{home_id}/audit/start", status_code=201)
def start_audit_route(home_id: str, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        audit = start_audit(db, str(user.id), home_id)
        return _ser_audit(audit, db)
    except Exception as e:
        raise _http(e)


@router.post("/audits/{audit_id}/scan")
def scan_item_audit(audit_id: str, body: AuditScanBody, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        return record_scan(db, str(user.id), audit_id, body.ein.strip())
    except Exception as e:
        raise _http(e)


@router.post("/audits/{audit_id}/complete")
def complete_audit_route(audit_id: str, body: AuditCompleteBody, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        audit = complete_audit(db, str(user.id), audit_id, body.notes)
        return _ser_audit(audit, db)
    except Exception as e:
        raise _http(e)


@router.post("/audits/{audit_id}/discrepancy")
def get_audit_discrepancy_report(
    audit_id: str,
    mark_missing: bool = False,
    db: Session = Depends(get_db),
    user: InvUser = Depends(get_current_inv_user),
):
    from inventory.file_utils import INVENTORY_FILES_BASE_DIR
    try:
        pdf_path = generate_audit_discrepancy_report(db, str(user.id), audit_id, mark_missing)
        base = os.path.realpath(INVENTORY_FILES_BASE_DIR)
        full_path = os.path.realpath(pdf_path)
        if not full_path.startswith(base + os.sep):
            raise bad_request("Invalid file path.")
        return FileResponse(
            full_path,
            media_type="application/pdf",
            filename=os.path.basename(full_path),
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise _http(e)

@router.get("/homes/{home_id}/audit/history")
def audit_history(home_id: str, db: Session = Depends(get_db),
                  user: InvUser = Depends(get_current_inv_user)):
    try:
        return [_ser_audit(a, db)
                for a in get_audit_history(db, str(user.id), home_id)]
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------

@router.get("/items/{item_id}/attachments")
def list_attachments(item_id: str, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        return [_ser_attachment(a)
                for a in get_attachments(db, str(user.id), item_id)]
    except Exception as e:
        raise _http(e)


@router.post("/items/{item_id}/attachments", status_code=201)
async def upload_attachment(
    item_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: InvUser = Depends(get_current_inv_user),
):
    ALLOWED_MIME_TYPES = {
        "image/jpeg", "image/png", "image/webp", "image/gif",
        "application/pdf",
        "text/plain",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
    MAX_BYTES = 10 * 1024 * 1024  # 10 MB

    mime = (file.content_type or "").lower().split(";")[0].strip()
    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail="File type not allowed. Permitted: images, PDF, plain text, Word documents.")

    try:
        data = await file.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail="File exceeds 10 MB limit.")
        attachment = add_attachment(
            db, str(user.id), item_id,
            data=data,
            original_filename=file.filename or "file",
            mime_type=mime,
        )
        return _ser_attachment(attachment)
    except HTTPException:
        raise
    except Exception as e:
        raise _http(e)


@router.get("/attachments/{attachment_id}/download")
def download_attachment(attachment_id: str, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    from inventory.file_utils import INVENTORY_FILES_BASE_DIR
    attachment = db.query(ItemAttachment).filter(
        ItemAttachment.id == _uid(attachment_id)).first()
    if not attachment:
        raise not_found("Attachment not found")
    try:
        get_attachments(
            db, str(
                user.id), str(
                attachment.item_id))  # permission check
    except Exception as e:
        raise _http(e)

    base = os.path.realpath(INVENTORY_FILES_BASE_DIR)
    full_path = os.path.realpath(os.path.join(base, attachment.stored_path))
    if not full_path.startswith(base + os.sep):
        raise bad_request("Invalid file path.")

    if not os.path.exists(full_path):
        raise not_found("File not found on disk")
    safe_filename = os.path.basename(attachment.original_filename or "file")
    return FileResponse(full_path, filename=safe_filename,
                        media_type=attachment.mime_type or "application/octet-stream")


@router.delete("/attachments/{attachment_id}", status_code=204)
def remove_attachment(attachment_id: str, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        delete_attachment(db, str(user.id), attachment_id)
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# UPC Lookup
# ---------------------------------------------------------------------------

@router.get("/lookup/upc/{upc}")
def lookup_upc(upc: str, user: InvUser = Depends(get_current_inv_user)):
    from providers.product_lookup import get_product_lookup_provider
    provider = get_product_lookup_provider()
    result = provider.lookup_upc(upc)
    if not result:
        raise not_found("Product not found for the given UPC")
    return result.dict()

# ---------------------------------------------------------------------------
# Label Generation
# ---------------------------------------------------------------------------

@router.get("/homes/{home_id}/labels.pdf")
def get_home_labels(
    home_id: str,
    only_unprinted: bool = False,
    db: Session = Depends(get_db),
    user: InvUser = Depends(get_current_inv_user),
):
    from fastapi.responses import StreamingResponse
    from inventory.labels import generate_labels_pdf
    from datetime import datetime, timezone
    
    home = db.query(InvHome).filter(InvHome.id == _uid(home_id)).first()
    if not home:
        raise not_found("Home not found")
        
    try:
        get_homes_for_user(db, str(user.id))
    except PermissionDeniedError:
        raise forbidden("Not permitted")
        
    query = db.query(InventoryItem).filter(InventoryItem.home_id == home.id)
    if only_unprinted:
        query = query.filter(InventoryItem.label_printed_at == None)
        
    items = query.all()
    if not items:
        raise bad_request("No items found to print labels for.")
        
    pdf_buffer = generate_labels_pdf(items)
    
    # Update label_printed_at
    if only_unprinted:
        now = datetime.now(timezone.utc)
        for item in items:
            item.label_printed_at = now
        db.commit()
    
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=labels_{home_id}.pdf"}
    )

# ---------------------------------------------------------------------------
# Receipt / warranty uploads
# ---------------------------------------------------------------------------

_RECEIPT_ALLOWED_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf"}
_RECEIPT_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/items/{item_id}/receipt")
async def upload_receipt(
    item_id: str,
    file: UploadFile = File(...),
    manual_price: Optional[float] = Form(None),
    manual_date: Optional[date] = Form(None),
    db: Session = Depends(get_db),
    user: InvUser = Depends(get_current_inv_user),
):
    mime = (file.content_type or "").lower().split(";")[0].strip()
    if mime not in _RECEIPT_ALLOWED_MIME:
        raise HTTPException(
            status_code=415,
            detail="File type not allowed. Permitted: JPEG, PNG, WebP, PDF.")
    try:
        data = await file.read()
        if len(data) > _RECEIPT_MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail="File exceeds 10 MB limit.")
        item = process_receipt(db,
                               str(user.id),
                               item_id,
                               data,
                               file.filename or "receipt",
                               manual_price,
                               manual_date)
        return _ser_item(item)
    except HTTPException:
        raise
    except Exception as e:
        raise _http(e)


_WARRANTY_ALLOWED_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf"}
_WARRANTY_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/items/{item_id}/warranty-image")
async def upload_warranty_image(
    item_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: InvUser = Depends(get_current_inv_user),
):
    from inventory.file_utils import save_file_for_home
    from inventory.management import _get_item_or_raise
    mime = (file.content_type or "").lower().split(";")[0].strip()
    if mime not in _WARRANTY_ALLOWED_MIME:
        raise HTTPException(
            status_code=415,
            detail="File type not allowed. Permitted: JPEG, PNG, WebP, PDF.")
    try:
        item = _get_item_or_raise(db, item_id)
        set_active_home(db, str(user.id), str(item.home_id))
        data = await file.read()
        if len(data) > _WARRANTY_MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail="File exceeds 10 MB limit.")
        rel_path = save_file_for_home(
            str(item.home_id), "warranties", data, file.filename or "warranty")
        item.warranty_image_path = rel_path
        db.commit()
        db.refresh(item)
        return _ser_item(item)
    except HTTPException:
        raise
    except Exception as e:
        raise _http(e)




# ---------------------------------------------------------------------------
# Collaborators
# ---------------------------------------------------------------------------

@router.get("/homes/{home_id}/collaborators")
def list_collaborators(home_id: str, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        set_active_home(db, str(user.id), home_id)
        rows = db.execute(
            collaborators_table.select().where(
                collaborators_table.c.home_id == _uid(home_id))
        ).fetchall()
        result = []
        for row in rows:
            collab = db.query(InvUser).filter(
                InvUser.id == _uid(row.user_id)).first()
            result.append({
                "user_id": str(row.user_id),
                "email": collab.email if collab else None,
                "name": collab.display_name if collab else None,
                "role": row.role.value if hasattr(row.role, "value") else row.role,
                "since": row.created_at.isoformat() if row.created_at else None,
            })
        return result
    except Exception as e:
        raise _http(e)


@router.post("/homes/{home_id}/collaborators", status_code=201)
def add_collaborator(home_id: str, body: CollaboratorAdd, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    collab = db.query(InvUser).filter(InvUser.email == body.user_email).first()
    if not collab:
        raise not_found(f"No user with email '{body.user_email}'")
    try:
        manage_collaborators(
            db, str(
                user.id), home_id, str(
                collab.id), "add", body.role)
        return {"status": "added", "email": body.user_email,
                "role": body.role.value}
    except Exception as e:
        raise _http(e)


@router.patch("/homes/{home_id}/collaborators/{collab_user_id}")
def update_collaborator_role(home_id: str, collab_user_id: str, body: CollaboratorRoleUpdate,
                             db: Session = Depends(get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        manage_collaborators(db, str(user.id), home_id,
                             collab_user_id, "update_role", body.role)
        return {"status": "updated", "role": body.role.value}
    except Exception as e:
        raise _http(e)


@router.delete("/homes/{home_id}/collaborators/{collab_user_id}",
               status_code=204)
def remove_collaborator(home_id: str, collab_user_id: str, db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    try:
        manage_collaborators(db, str(user.id), home_id,
                             collab_user_id, "remove")
    except Exception as e:
        raise _http(e)


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@router.get("/homes/{home_id}/manifest")
def insurance_manifest(home_id: str, fmt: str = "pdf", db: Session = Depends(
        get_db), user: InvUser = Depends(get_current_inv_user)):
    from inventory.file_utils import INVENTORY_FILES_BASE_DIR
    try:
        manifest_files = generate_insurance_manifest(db, str(user.id), home_id)
        file_path = manifest_files.get(fmt)
        if not file_path:
            raise bad_request(f"Invalid format requested: {fmt}")
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise _http(e)
    base = os.path.realpath(INVENTORY_FILES_BASE_DIR)
    full_path = os.path.realpath(file_path)
    if not full_path.startswith(base + os.sep):
        raise bad_request("Invalid file path.")
    return FileResponse(
        full_path,
        media_type="application/pdf" if fmt == "pdf" else "text/csv",
        filename=os.path.basename(full_path),
    )
