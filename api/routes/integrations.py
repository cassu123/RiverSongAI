from fastapi import APIRouter, Depends, HTTPException, status, Request, Header
from typing import Optional
from pydantic import BaseModel
import os
import json
from datetime import datetime

from api.routes.auth import _require_admin
from providers.memory.sqlite_store import SQLiteStore
from cryptography.fernet import Fernet

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

class IntegrationStatus(BaseModel):
    service: str
    connected: bool
    metadata: dict = {}

class IntegrationListResponse(BaseModel):
    integrations: dict  # {service_key: IntegrationStatus}

class IntegrationUpdateRequest(BaseModel):
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    token_expires_at: Optional[datetime] = None
    metadata: Optional[dict] = None

def _get_encryption_key() -> bytes:
    key = os.getenv("TOKEN_ENCRYPTION_KEY")
    if not key:
        # Fallback for dev/testing if not set
        key = Fernet.generate_key().decode()
        os.environ["TOKEN_ENCRYPTION_KEY"] = key
    return key.encode()

def encrypt_token(token: str) -> str:
    f = Fernet(_get_encryption_key())
    return f.encrypt(token.encode()).decode()

def decrypt_token(encrypted_token: str) -> str:
    f = Fernet(_get_encryption_key())
    return f.decrypt(encrypted_token.encode()).decode()

def _get_store(request: Request) -> SQLiteStore:
    return request.app.state.memory_manager._store

@router.get("/status", response_model=IntegrationListResponse)
async def get_integration_status(request: Request, authorization: Optional[str] = Header(default=None)):
    payload = await _require_admin(request, authorization)
    user_id = payload.get("sub") or payload.get("id")
    store = _get_store(request)
    
    # Get user_id from token if needed, or assume global admin
    # River Song often uses 'admin' as a generic user for the local instance, 
    # but we'll use the ID from the JWT payload
    if not user_id:
        user_id = "admin_user" # Fallback
        
    integrations = await store.get_user_integrations(user_id)
    
    available_services = ["google", "shopify", "amazon_sp_api", "walmart", "tiktok"]
    
    result = {}
    for service in available_services:
        integration = next((i for i in integrations if i["service"] == service), None)
        if integration and integration.get("is_active"):
            result[service] = {
                "connected": True,
                "metadata": integration.get("metadata", {})
            }
        else:
            result[service] = {
                "connected": False,
                "metadata": {}
            }
    
    return IntegrationListResponse(integrations=result)

@router.delete("/{service}/disconnect")
async def disconnect_service(service: str, request: Request, authorization: Optional[str] = Header(default=None)):
    payload = await _require_admin(request, authorization)
    user_id = payload.get("sub") or payload.get("id") or "admin_user"
    store = _get_store(request)
    
    integration = await store.get_user_integration(user_id, service)
    if not integration or not integration.get("is_active"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No active {service} integration found")
        
    await store.deactivate_user_integration(user_id, service)
    
    return {"message": f"Successfully disconnected {service}"}

@router.post("/{service}/store")
async def store_integration_tokens(service: str, token_data: IntegrationUpdateRequest, request: Request, authorization: Optional[str] = Header(default=None)):
    payload = await _require_admin(request, authorization)
    user_id = payload.get("sub") or payload.get("id") or "admin_user"
    store = _get_store(request)
    
    access_token = encrypt_token(token_data.access_token) if token_data.access_token else None
    refresh_token = encrypt_token(token_data.refresh_token) if token_data.refresh_token else None
    expires_at = token_data.token_expires_at.isoformat() if token_data.token_expires_at else None
    
    await store.upsert_user_integration(
        user_id=user_id,
        service=service,
        access_token=access_token,
        refresh_token=refresh_token,
        token_expires_at=expires_at,
        metadata=token_data.metadata
    )
    
    return {"message": f"Successfully stored {service} tokens"}
