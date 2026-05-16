# =============================================================================
# api/routes/auth.py
#
# Endpoints:
#   GET  /api/auth/setup-status -- returns whether first admin setup is needed
#   POST /api/auth/setup        -- create the first admin account (one-time)
#   POST /api/auth/signup       -- create new account (pending approval)
#   POST /api/auth/login        -- returns JWT token
#   GET  /api/auth/me           -- returns current user from token
# =============================================================================

from __future__ import annotations

import json
import uuid
import logging
import re
import dotenv
from pathlib import Path

import bcrypt
from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel, EmailStr
from typing import Optional
import httpx

from core.auth import create_access_token, decode_token
from config.settings import get_settings
from core.limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupBody(BaseModel):
    email: EmailStr
    password: str
    display_name: str


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


class SetupBody(BaseModel):
    email: EmailStr
    password: str
    display_name: str


def _get_store(request: Request):
    return request.app.state.memory_manager._store


@router.get("/setup-status")
async def setup_status(request: Request):
    store = _get_store(request)
    admin_exists = await store.has_admin()
    return {"setup_required": not admin_exists}


@router.post("/setup")
async def setup(request: Request, body: SetupBody):
    store = _get_store(request)

    if await store.has_admin():
        raise HTTPException(status_code=409, detail="Admin account already exists.")

    if len(body.password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters.")

    if await store.email_exists(body.email.lower()):
        raise HTTPException(status_code=409, detail="An account with that email already exists.")

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user_id = str(uuid.uuid4())

    await store.create_user(
        id=user_id,
        email=body.email.lower(),
        password_hash=password_hash,
        display_name=body.display_name,
        role="admin",
        is_approved=True,
    )

    token = create_access_token(user_id=user_id, email=body.email.lower(), role="admin")
    logger.info("Master admin account created: %s", body.email.replace('\n', '').replace('\r', ''))
    return {"token": token, "user": {"id": user_id, "email": body.email.lower(), "display_name": body.display_name, "role": "admin", "is_approved": True}}


@router.post("/signup")
@limiter.limit(get_settings().rate_limit_auth_signup)
async def signup(request: Request, body: SignupBody):
    if len(body.password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters.")

    store = _get_store(request)

    if not await store.has_admin():
        raise HTTPException(status_code=400, detail="System not yet configured. Please complete admin setup first.")

    if await store.email_exists(body.email.lower()):
        raise HTTPException(status_code=409, detail="An account with that email already exists.")

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user_id = str(uuid.uuid4())

    await store.create_user(
        id=user_id,
        email=body.email.lower(),
        password_hash=password_hash,
        display_name=body.display_name,
        role="user",
        is_approved=False,
    )

    logger.info("New user registered (pending approval): %s", body.email.replace('\n', '').replace('\r', ''))
    return {"pending": True, "message": "Account created. An admin must approve your account before you can log in."}


@router.post("/login")
@limiter.limit(get_settings().rate_limit_auth_login)
async def login(request: Request, body: LoginBody):
    store = _get_store(request)
    user = await store.get_user_by_email(body.email.lower())

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not user["is_approved"]:
        raise HTTPException(status_code=403, detail="Your account is pending admin approval.")

    token = create_access_token(user_id=user["id"], email=user["email"], role=user["role"])
    logger.info("User logged in: %s", body.email.replace('\n', '').replace('\r', ''))
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "display_name": user["display_name"], "role": user["role"], "is_approved": user["is_approved"]},
    }


@router.post("/logout", status_code=204)
async def logout(request: Request, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        return # Ignore if not logged in

    token = authorization.removeprefix("Bearer ").strip()
    payload = await decode_token(token)
    if not payload:
        return # Already invalid

    jti = payload.get("jti")
    if jti:
        store = _get_store(request)
        # expires_at is required for revocation record
        exp = payload.get("exp")
        expires_at = datetime.fromtimestamp(exp, tz=timezone.utc) if exp else datetime.now(tz=timezone.utc) + timedelta(days=1)
        await store.revoke_token(jti, payload["sub"], expires_at)
    
    return


@router.get("/me")
async def me(request: Request, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")

    token = authorization.removeprefix("Bearer ")
    payload = await decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    store = _get_store(request)
    user = await store.get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")

    return user

@router.patch("/password")
async def change_password(body: ChangePasswordBody, request: Request, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")

    token = authorization.removeprefix("Bearer ")
    payload = await decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    store = _get_store(request)
    user = await store.get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")

    if not bcrypt.checkpw(body.current_password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    new_hash = bcrypt.hashpw(body.new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    await store.update_user_password(user["id"], new_hash)

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Integrations / API Keys
# ---------------------------------------------------------------------------

class IntegrationsUpdate(BaseModel):
    amazon_sp_api: Optional[dict] = None
    walmart_api:   Optional[dict] = None


async def _require_admin(request: Request, authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return payload


@router.get("/integrations")
async def get_integrations(request: Request, authorization: Optional[str] = Header(default=None)):
    await _require_admin(request, authorization)
    store = _get_store(request)
    integrations = await store.get_integrations()

    # Helper to get and mask
    def _val(key: str, is_secret: bool = False) -> str:
        v = integrations.get(key, "")
        if not v:
            # Fallback to env for initial migration/compatibility
            v = os.environ.get(key, "")
        if v and is_secret:
            return "__SET__"
        return v

    return {
        "amazon_sp_api": {
            "lwa_app_id":         _val("AMAZON_SP_LWA_APP_ID"),
            "lwa_client_secret":  _val("AMAZON_SP_LWA_CLIENT_SECRET", True),
            "lwa_refresh_token":  _val("AMAZON_SP_REFRESH_TOKEN", True),
            "aws_access_key":     _val("AMAZON_AWS_ACCESS_KEY"),
            "aws_secret_key":     _val("AMAZON_AWS_SECRET_KEY", True),
            "seller_id":          _val("AMAZON_SELLER_ID"),
        },
        "walmart_api": {
            "client_id":          _val("WALMART_CLIENT_ID"),
            "client_secret":      _val("WALMART_CLIENT_SECRET", True),
        }
    }


@router.put("/integrations")
async def save_integrations(body: IntegrationsUpdate, request: Request, authorization: Optional[str] = Header(default=None)):
    await _require_admin(request, authorization)
    store = _get_store(request)
    integrations = await store.get_integrations()

    if body.amazon_sp_api:
        a = body.amazon_sp_api
        if a.get("lwa_app_id") is not None:         integrations["AMAZON_SP_LWA_APP_ID"] = a["lwa_app_id"]
        if a.get("lwa_client_secret") not in [None, "__SET__"]: integrations["AMAZON_SP_LWA_CLIENT_SECRET"] = a["lwa_client_secret"]
        if a.get("lwa_refresh_token") not in [None, "__SET__"]: integrations["AMAZON_SP_REFRESH_TOKEN"] = a["lwa_refresh_token"]
        if a.get("aws_access_key") is not None:     integrations["AMAZON_AWS_ACCESS_KEY"] = a["aws_access_key"]
        if a.get("aws_secret_key") not in [None, "__SET__"]: integrations["AMAZON_AWS_SECRET_KEY"] = a["aws_secret_key"]
        if a.get("seller_id") is not None:          integrations["AMAZON_SELLER_ID"] = a["seller_id"]

    if body.walmart_api:
        w = body.walmart_api
        if w.get("client_id") is not None:          integrations["WALMART_ID"] = w["client_id"]
        if w.get("client_secret") not in [None, "__SET__"]: integrations["WALMART_CLIENT_SECRET"] = w["client_secret"]

    await store.set_integrations(integrations)
    
    # Inject into live os.environ so providers see it immediately
    for k, v in integrations.items():
        if v: os.environ[k] = str(v)

    return {"ok": True}



# =============================================================================
# Google OAuth
# =============================================================================

def _load_google_client() -> dict:
    """Return the 'web' block from the client secrets JSON."""
    settings = get_settings()
    path = Path(settings.google_client_secrets_path)
    if not path.exists():
        raise HTTPException(status_code=500, detail="Google client secrets not configured.")
    data = json.loads(path.read_text())
    return data.get("web") or data.get("installed") or {}


class GoogleCallbackBody(BaseModel):
    code: str
    redirect_uri: str


@router.get("/google/authorize")
async def google_authorize():
    """Return the Google OAuth consent-screen URL for the frontend to redirect to."""
    client = _load_google_client()
    client_id = client.get("client_id", "")
    auth_uri = client.get("auth_uri", "https://accounts.google.com/o/oauth2/auth")
    scope = "openid email profile"
    params = (
        f"client_id={client_id}"
        f"&response_type=code"
        f"&scope={scope.replace(' ', '%20')}"
        f"&access_type=offline"
        f"&prompt=consent"
    )
    return {"auth_uri": auth_uri, "client_id": client_id, "scope": scope,
            "auth_url": f"{auth_uri}?{params}"}


@router.post("/google/callback")
async def google_callback(request: Request, body: GoogleCallbackBody):
    """Exchange auth code for tokens, resolve the user, return a JWT."""
    client = _load_google_client()
    store = _get_store(request)

    # Exchange code for tokens
    token_uri = client.get("token_uri", "https://oauth2.googleapis.com/token")
    async with httpx.AsyncClient() as http:
        token_resp = await http.post(token_uri, data={
            "code": body.code,
            "client_id": client["client_id"],
            "client_secret": client["client_secret"],
            "redirect_uri": body.redirect_uri,
            "grant_type": "authorization_code",
        })
    if token_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange Google auth code.")
    tokens = token_resp.json()
    access_token = tokens.get("access_token")

    # Fetch Google profile
    async with httpx.AsyncClient() as http:
        profile_resp = await http.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if profile_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to fetch Google profile.")
    profile = profile_resp.json()

    google_id = profile["id"]
    google_email = profile["email"]
    display_name = profile.get("name") or google_email.split("@")[0]

    # 1) existing user linked by google_id
    user = await store.get_user_by_google_id(google_id)

    # 2) existing user with same email → auto-link
    if not user:
        user = await store.get_user_by_email(google_email.lower())
        if user:
            await store.link_google_account(user["id"], google_id, google_email)
            user = await store.get_user_by_id(user["id"])

    # 3) new user — create and auto-approve
    if not user:
        new_id = str(uuid.uuid4())
        # First Google user gets admin if no admin exists yet
        role = "admin" if not await store.has_admin() else "user"
        await store.create_google_user(
            id=new_id,
            email=google_email.lower(),
            display_name=display_name,
            google_id=google_id,
            google_email=google_email,
            role=role,
            is_approved=True,
        )
        user = await store.get_user_by_id(new_id)

    if not user["is_approved"]:
        raise HTTPException(status_code=403, detail="Your account is pending admin approval.")

    token = create_access_token(user_id=user["id"], email=user["email"], role=user["role"])
    logger.info("Google sign-in: %s", google_email)
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "display_name": user["display_name"], "role": user["role"], "is_approved": user["is_approved"]},
    }


class ProfilePatch(BaseModel):
    theme: Optional[str] = None
    palette: Optional[str] = None
    environment: Optional[str] = None
    display_name: Optional[str] = None

VALID_THEMES = {"halo", "crimson-dark", "combat", "midnight-violet", "amber", "arctic", "cyberpunk", "dune"}
VALID_PALETTES     = {"spice", "halo"}
VALID_ENVIRONMENTS = {"atreides", "harkonnen", "forerunner", "unsc"}

# Cross-validation: which environments are legal under which palette
PALETTE_ENV_PAIRS = {
    "spice": {"atreides", "harkonnen"},
    "halo":  {"forerunner", "unsc"},
}


@router.post("/ws-ticket")
async def get_ws_ticket(request: Request, authorization: Optional[str] = Header(default=None)):
    """
    Exchange a long-lived JWT for a one-time 60s WebSocket ticket.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    
    token = authorization.removeprefix("Bearer ").strip()
    payload = await decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    
    user_id = payload["sub"]
    settings = get_settings()
    ticket = str(uuid.uuid4())
    
    request.app.state.ws_tickets[ticket] = {
        "user_id":    user_id,
        "expires_at": datetime.now(tz=timezone.utc).timestamp() + settings.ws_ticket_lifetime_seconds,
        "is_kiosk":   False
    }
    
    return {"ticket": ticket, "expires_in": settings.ws_ticket_lifetime_seconds}


@router.post("/ws-ticket/kiosk")
async def get_ws_ticket_kiosk(request: Request, x_kiosk_token: Optional[str] = Header(None, alias="X-Kiosk-Token")):
    """
    Exchange the kiosk secret for a one-time 60s WebSocket ticket.
    """
    settings = get_settings()
    if not x_kiosk_token or x_kiosk_token != settings.kiosk_token:
        raise HTTPException(status_code=401, detail="Invalid kiosk token.")
    
    ticket = str(uuid.uuid4())
    request.app.state.ws_tickets[ticket] = {
        "user_id":    settings.default_user_id,
        "expires_at": datetime.now(tz=timezone.utc).timestamp() + settings.ws_ticket_lifetime_seconds,
        "is_kiosk":   True
    }
    
    return {"ticket": ticket, "expires_in": settings.ws_ticket_lifetime_seconds}


@router.get("/profile")
async def get_profile(request: Request, authorization: Optional[str] = Header(default=None)):
    store = request.app.state.memory_manager._store
    token = (authorization or "").removeprefix("Bearer ").strip()
    payload = await decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await store.get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "role": user["role"],
        "theme": user.get("theme", "halo"),
        "palette": user.get("palette", "spice"),
        "environment": user.get("environment", "atreides"),
    }


@router.patch("/profile")
async def update_profile(body: ProfilePatch, request: Request, authorization: Optional[str] = Header(default=None)):
    store = request.app.state.memory_manager._store
    token = (authorization or "").removeprefix("Bearer ").strip()
    payload = await decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload["sub"]

    if body.theme is not None:
        if body.theme not in VALID_THEMES:
            raise HTTPException(status_code=400, detail=f"Invalid theme. Valid: {', '.join(VALID_THEMES)}")
        await store.update_user_theme(user_id, body.theme)

    if body.palette is not None:
        if body.palette not in VALID_PALETTES:
            raise HTTPException(status_code=400, detail=f"Invalid palette. Valid: {', '.join(VALID_PALETTES)}")
        await store.update_user_palette(user_id, body.palette)

    if body.environment is not None:
        if body.environment not in VALID_ENVIRONMENTS:
            raise HTTPException(status_code=400, detail=f"Invalid environment. Valid: {', '.join(VALID_ENVIRONMENTS)}")
        # Cross-validation: enforce pairing
        user_record = await store.get_user_by_id(user_id)
        current_palette = body.palette or user_record.get("palette", "spice")
        if body.environment not in PALETTE_ENV_PAIRS.get(current_palette, set()):
            raise HTTPException(status_code=400, detail=f"environment '{body.environment}' is not valid under palette '{current_palette}'")
        await store.update_user_environment(user_id, body.environment)

    user = await store.get_user_by_id(user_id)
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "role": user["role"],
        "theme": user.get("theme", "halo"),
        "palette": user.get("palette", "spice"),
        "environment": user.get("environment", "atreides"),
    }
