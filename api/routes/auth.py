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
import os
import uuid
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel, EmailStr
from typing import Optional
import httpx

from core.auth import create_access_token, decode_token
from core.errors import api_error, bad_request, conflict, forbidden, not_found, unauthorized
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


class ForceChangePasswordBody(BaseModel):
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
        raise conflict("Admin account already exists.")

    if len(body.password) < 12:
        raise bad_request("Password must be at least 12 characters.")

    if await store.email_exists(body.email.lower()):
        raise conflict("An account with that email already exists.")

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
        raise bad_request("Password must be at least 12 characters.")

    store = _get_store(request)

    if not await store.has_admin():
        raise bad_request("System not yet configured. Please complete admin setup first.")

    if await store.email_exists(body.email.lower()):
        raise conflict("An account with that email already exists.")

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
        raise unauthorized("Invalid email or password.")

    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise unauthorized("Invalid email or password.")

    if not user["is_approved"]:
        raise forbidden("Your account is pending admin approval.")

    token = create_access_token(user_id=user["id"], email=user["email"], role=user["role"])
    logger.info("User logged in: %s", body.email.replace('\n', '').replace('\r', ''))
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "display_name": user["display_name"],
            "role": user["role"],
            "is_approved": user["is_approved"],
            "force_password_change": user.get("force_password_change", False)
        },
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
        raise unauthorized("Not authenticated.")

    token = authorization.removeprefix("Bearer ")
    payload = await decode_token(token)
    if not payload:
        raise unauthorized("Invalid or expired token.")

    store = _get_store(request)
    user = await store.get_user_by_id(payload["sub"])
    if not user:
        raise unauthorized("User not found.")

    return user

@router.patch("/password")
async def change_password(body: ChangePasswordBody, request: Request, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")

    token = authorization.removeprefix("Bearer ")
    payload = await decode_token(token)
    if not payload:
        raise unauthorized("Invalid or expired token.")

    store = _get_store(request)
    user = await store.get_user_by_id(payload["sub"])
    if not user:
        raise unauthorized("User not found.")

    if not bcrypt.checkpw(body.current_password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        raise unauthorized("Current password is incorrect.")

    new_hash = bcrypt.hashpw(body.new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    await store.update_user_password(user["id"], new_hash)

    return {"status": "ok"}


@router.post("/force-change-password")
async def force_change_password(body: ForceChangePasswordBody, request: Request, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")

    token = authorization.removeprefix("Bearer ")
    payload = await decode_token(token)
    if not payload:
        raise unauthorized("Invalid or expired token.")

    store = _get_store(request)
    user = await store.get_user_by_id(payload["sub"])
    if not user:
        raise unauthorized("User not found.")

    if not user.get("force_password_change"):
        raise bad_request("Password change not required.")

    if len(body.new_password) < 12:
        raise bad_request("Password must be at least 12 characters.")

    new_hash = bcrypt.hashpw(body.new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    await store.update_user_password(user["id"], new_hash)
    logger.info("User %s completed mandatory password change", user["id"])

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Integrations / API Keys
# ---------------------------------------------------------------------------

class IntegrationsUpdate(BaseModel):
    amazon_sp_api: Optional[dict] = None
    walmart_api:   Optional[dict] = None


async def _require_admin(request: Request, authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    if payload.get("role") != "admin":
        raise forbidden("Admin access required.")
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
    from providers.google.auth import DEFAULT_SCOPES
    client = _load_google_client()
    client_id = client.get("client_id", "")
    auth_uri = client.get("auth_uri", "https://accounts.google.com/o/oauth2/auth")
    scope = " ".join(DEFAULT_SCOPES)
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
        raise bad_request("Failed to exchange Google auth code.")
    tokens = token_resp.json()
    access_token = tokens.get("access_token")

    # Fetch Google profile
    async with httpx.AsyncClient() as http:
        profile_resp = await http.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if profile_resp.status_code != 200:
        raise bad_request("Failed to fetch Google profile.")
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
        raise forbidden("Your account is pending admin approval.")

    token = create_access_token(user_id=user["id"], email=user["email"], role=user["role"])
    logger.info("Google sign-in: %s", google_email)

    # Sync tokens to service storage so AI can use Calendar/Gmail immediately
    try:
        from providers.google.auth import GoogleAuth
        settings = get_settings()
        auth = GoogleAuth(
            client_secrets_path=settings.google_client_secrets_path,
            token_storage_path=settings.google_token_storage_path,
        )
        # Credentials.from_authorized_user_info expects 'token' not 'access_token'
        # and needs client_id/client_secret to be able to refresh.
        sync_data = {
            **tokens,
            "token": tokens.get("access_token"),
            "client_id": client.get("client_id"),
            "client_secret": client.get("client_secret"),
        }
        auth.save_credentials_from_dict(user["id"], sync_data)
        logger.info("Synced Google tokens to service storage for user %s", user["id"])
    except Exception as exc:
        logger.warning("Failed to sync Google tokens to service storage: %s", exc)

    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "display_name": user["display_name"], "role": user["role"], "is_approved": user["is_approved"]},
    }


class ProfilePatch(BaseModel):
    # New three-axis: universe -> environment -> mood
    universe: Optional[str] = None
    environment: Optional[str] = None
    mood: Optional[str] = None
    display_name: Optional[str] = None
    # Legacy fields kept for backward compatibility with older clients.
    # New clients should ignore these. Writes still accepted and translated below.
    theme: Optional[str] = None
    palette: Optional[str] = None

VALID_UNIVERSES = {"dune", "halo", "mv", "nightcity"}
VALID_ENVIRONMENTS = {
    "atreides", "harkonnen",       # dune
    "forerunner", "unsc",          # halo
    "spires", "garden",            # monument valley
    "corpo", "pacifica",           # night city
}

# Which environments are legal under which universe
UNIVERSE_ENV_PAIRS = {
    "dune":      {"atreides", "harkonnen"},
    "halo":      {"forerunner", "unsc"},
    "mv":        {"spires", "garden"},
    "nightcity": {"corpo", "pacifica"},
}

# Which moods are legal under which environment
ENV_MOOD_PAIRS = {
    "atreides":   {"caladan", "spice-hall"},
    "harkonnen":  {"giedi", "bloodlight"},
    "forerunner": {"hard-light", "ceramic-veil"},
    "unsc":       {"combat-steel", "night-vision"},
    "spires":     {"sacred", "daybreak-temple", "twilight-spires"},
    "garden":     {"pastel-day", "dusk-pavilion"},
    "corpo":      {"chrome", "executive"},
    "pacifica":   {"glitch-street", "smoke"},
}

# Legacy theme/palette -> new (universe, environment, mood) for one-time client migrations
LEGACY_THEME_MAP = {
    "halo":            ("halo",      "forerunner", "hard-light"),
    "crimson-dark":    ("dune",      "harkonnen",  "bloodlight"),
    "combat":          ("halo",      "unsc",       "night-vision"),
    "midnight-violet": ("mv",        "spires",     "twilight-spires"),
    "amber":           ("mv",        "garden",     "dusk-pavilion"),
    "arctic":          ("mv",        "spires",     "daybreak-temple"),
    "cyberpunk":       ("nightcity", "pacifica",   "glitch-street"),
    "dune":            ("dune",      "atreides",   "spice-hall"),
}


@router.post("/ws-ticket")
async def get_ws_ticket(request: Request, authorization: Optional[str] = Header(default=None)):
    """
    Exchange a long-lived JWT for a one-time 60s WebSocket ticket.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    
    token = authorization.removeprefix("Bearer ").strip()
    payload = await decode_token(token)
    if not payload:
        raise unauthorized("Invalid or expired token.")
    
    user_id = payload["sub"]
    settings = get_settings()
    ticket = str(uuid.uuid4())
    
    request.app.state.ws_tickets[ticket] = {
        "user_id":    user_id,
        "expires_at": datetime.now(tz=timezone.utc).timestamp() + settings.ws_ticket_lifetime_seconds,
    }

    return {"ticket": ticket, "expires_in": settings.ws_ticket_lifetime_seconds}


@router.get("/profile")
async def get_profile(request: Request, authorization: Optional[str] = Header(default=None)):
    store = request.app.state.memory_manager._store
    token = (authorization or "").removeprefix("Bearer ").strip()
    payload = await decode_token(token)
    if not payload:
        raise unauthorized("Invalid token")
    user = await store.get_user_by_id(payload["sub"])
    if not user:
        raise not_found("User not found")
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "role": user["role"],
        "universe": user.get("universe", "dune"),
        "environment": user.get("environment", "atreides"),
        "mood": user.get("mood", "caladan"),
        # Legacy fields, kept readable so older clients don't crash. Newer clients ignore.
        "theme": user.get("theme", "halo"),
        "palette": user.get("palette", "spice"),
    }


@router.patch("/profile")
async def update_profile(body: ProfilePatch, request: Request, authorization: Optional[str] = Header(default=None)):
    store = request.app.state.memory_manager._store
    token = (authorization or "").removeprefix("Bearer ").strip()
    payload = await decode_token(token)
    if not payload:
        raise unauthorized("Invalid token")
    user_id = payload["sub"]

    # Legacy translation: if a client still sends `theme`, map it to the new triple
    if body.theme is not None and body.theme in LEGACY_THEME_MAP:
        u, e, m = LEGACY_THEME_MAP[body.theme]
        if body.universe is None:    body.universe    = u
        if body.environment is None: body.environment = e
        if body.mood is None:        body.mood        = m
    # Legacy palette -> universe rename
    if body.palette is not None and body.universe is None:
        body.universe = "halo" if body.palette == "halo" else "dune"

    if body.universe is not None:
        if body.universe not in VALID_UNIVERSES:
            raise bad_request(f"Invalid universe. Valid: {', '.join(sorted(VALID_UNIVERSES))}")
        await store.update_user_universe(user_id, body.universe)

    if body.environment is not None:
        if body.environment not in VALID_ENVIRONMENTS:
            raise bad_request(f"Invalid environment. Valid: {', '.join(sorted(VALID_ENVIRONMENTS))}")
        user_record = await store.get_user_by_id(user_id)
        current_universe = body.universe or user_record.get("universe", "dune")
        if body.environment not in UNIVERSE_ENV_PAIRS.get(current_universe, set()):
            raise bad_request(f"environment '{body.environment}' is not valid under universe '{current_universe}'")
        await store.update_user_environment(user_id, body.environment)

    if body.mood is not None:
        user_record = await store.get_user_by_id(user_id)
        current_env = body.environment or user_record.get("environment", "atreides")
        if body.mood not in ENV_MOOD_PAIRS.get(current_env, set()):
            raise bad_request(f"mood '{body.mood}' is not valid under environment '{current_env}'")
        await store.update_user_mood(user_id, body.mood)

    user = await store.get_user_by_id(user_id)
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "role": user["role"],
        "universe": user.get("universe", "dune"),
        "environment": user.get("environment", "atreides"),
        "mood": user.get("mood", "caladan"),
        "theme": user.get("theme", "halo"),
        "palette": user.get("palette", "spice"),
    }
