from fastapi import APIRouter, Depends, HTTPException, status, Request, Header
from typing import Optional
from pydantic import BaseModel
import os
import json
import uuid
import httpx
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Request, Header
from fastapi.responses import RedirectResponse
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

# =============================================================================
# Google OAuth Integration Flow
# =============================================================================

def _load_google_client() -> dict:
    from core.config import get_settings
    from pathlib import Path
    settings = get_settings()
    path = Path(settings.google_client_secrets_path)
    if not path.exists():
        raise HTTPException(status_code=500, detail="Google client secrets not configured.")
    data = json.loads(path.read_text())
    return data.get("web") or data.get("installed") or {}

@router.get("/google/authorize")
async def google_authorize(request: Request, authorization: Optional[str] = Header(default=None)):
    from providers.google.auth import DEFAULT_SCOPES
    # Get current user ID
    token = request.cookies.get("rs_token") or (authorization.removeprefix("Bearer ") if authorization else None)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    # Simple decode for sub
    import jwt
    from core.config import get_settings
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub") or payload.get("id")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    client = _load_google_client()
    client_id = client.get("client_id", "")
    auth_uri = client.get("auth_uri", "https://accounts.google.com/o/oauth2/auth")
    
    # We require offline access and consent prompt for refresh token
    scope = " ".join(DEFAULT_SCOPES)
    redirect_uri = f"{request.url.scheme}://{request.url.netloc}/api/integrations/google/callback"
    
    # Create an isolated state token combining user_id and a random nonce
    state_nonce = str(uuid.uuid4())
    state = f"{user_id}::{state_nonce}"
    
    # Store state in DB (pulse_snapshots could work as a temp kv store, but for now we just pass user_id)
    # A true robust implementation would store state_nonce in a session table
    
    import urllib.parse
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope,
        "access_type": "offline",
        "prompt": "consent",
        "state": state
    })
    
    return RedirectResponse(f"{auth_uri}?{params}")


@router.get("/google/callback")
async def google_callback(request: Request, code: str, state: str, error: Optional[str] = None):
    if error:
        return RedirectResponse("/profile?error=google_auth_failed")
    
    try:
        user_id, state_nonce = state.split("::")
    except ValueError:
        return RedirectResponse("/profile?error=invalid_state")
        
    client = _load_google_client()
    store = _get_store(request)
    redirect_uri = f"{request.url.scheme}://{request.url.netloc}/api/integrations/google/callback"

    token_uri = client.get("token_uri", "https://oauth2.googleapis.com/token")
    async with httpx.AsyncClient() as http:
        token_resp = await http.post(token_uri, data={
            "code": code,
            "client_id": client["client_id"],
            "client_secret": client["client_secret"],
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
        
    if token_resp.status_code != 200:
        return RedirectResponse("/profile?error=token_exchange_failed")
        
    tokens = token_resp.json()
    access_token = encrypt_token(tokens.get("access_token"))
    refresh_token = encrypt_token(tokens.get("refresh_token")) if tokens.get("refresh_token") else None
    
    expires_in = tokens.get("expires_in", 3600)
    expires_at = (datetime.utcnow() + timedelta(seconds=expires_in)).isoformat()
    
    await store.upsert_user_integration(
        user_id=user_id,
        service="google",
        access_token=access_token,
        refresh_token=refresh_token,
        token_expires_at=expires_at,
        metadata={}
    )
    
    return RedirectResponse("/profile?connected=google")

