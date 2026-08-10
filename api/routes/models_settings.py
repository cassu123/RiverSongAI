# =============================================================================
# api/routes/models_settings.py
#
# File Purpose:
#   REST API endpoints for LLM model listing and per-user settings.
#   Used by the Settings page to read and write model selection, memory
#   settings, and to display cloud provider cost information.
#
# Endpoints:
#   GET  /api/models             -- full model catalog with enabled_providers map
#   GET  /api/settings/llm       -- current LLM settings for a user
#   POST /api/settings/llm       -- save LLM model selection
#   GET  /api/settings/memory    -- current memory settings for a user
#   POST /api/settings/memory    -- save memory settings
#
# Dependencies:
#   providers.llm.registry (LLMRegistry)
#   providers.memory.models (LLMSettings, MemorySettings, TTLOption)
#   core.memory_manager (accessed via request.app.state)
#   config.settings (get_settings)
# =============================================================================

from __future__ import annotations

import asyncio
import logging
import time
import urllib.request
import urllib.error
import json
from typing import List, Optional, Set, Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from config.settings import get_settings
from core.auth import decode_token
from api.routes.auth import bad_request, forbidden, not_found, unauthorized
from providers.llm.registry import LLMRegistry, ModelEntry
from providers.memory.models import LLMSettings, MemorySettings, TTLOption


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["settings"])


# =============================================================================
# Helpers
# =============================================================================

_OLLAMA_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _get_ollama_installed_models() -> Set[str]:
    """Query the local Ollama daemon for pulled model names. Returns empty set on failure."""
    # urlopen below is blocking, and this runs inside async routes. It used to
    # fire once per request; now that the saved-selection check needs the same
    # list as the catalog, a single chat load would have probed twice. A few
    # seconds of staleness is nothing next to holding the event loop for up to
    # the 3s timeout again — pulling a model is not a sub-second operation.
    global _ollama_cache, _ollama_cache_at
    if _ollama_cache and (time.monotonic() - _ollama_cache_at) < _OLLAMA_TTL_SECONDS:
        return set(_ollama_cache)

    try:
        settings = get_settings()
        base = getattr(
            settings,
            "ollama_base_url",
            "http://localhost:11434").rstrip("/")
        from urllib.parse import urlparse
        parsed = urlparse(base)
        if parsed.scheme == "http" and parsed.hostname not in _OLLAMA_LOCAL_HOSTS:
            raise ValueError(
                f"Insecure HTTP connection to remote Ollama host '{
                    parsed.hostname}' is not allowed. "
                "Use HTTPS or restrict OLLAMA_BASE_URL to localhost."
            )
        req = urllib.request.Request(
            f"{base}/api/tags",
            headers={
                "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
        models = {m["name"] for m in data.get("models", [])}
        _ollama_cache = models
        _ollama_cache_at = time.monotonic()
        return models
    except Exception as exc:
        # Ollama restarting / briefly unreachable: serve the last-known list
        # instead of making every local model vanish from the pickers.
        logger.warning("Ollama discovery failed (%s); using cached list (%d models)",
                       exc, len(_ollama_cache))
        return set(_ollama_cache)


# Last successful Ollama /api/tags result, kept so a transient outage
# doesn't empty the model pickers. `_ollama_cache_at` bounds how long it is
# served as fresh; after a failure the list is served regardless of age,
# which is the point of keeping it.
_ollama_cache: Set[str] = set()
_ollama_cache_at: float = 0.0
_OLLAMA_TTL_SECONDS = 5.0


#: Hardware verdicts (from core.hardware_cookbook) that mean "this machine
#: cannot run this model" — as opposed to merely running it slowly.
_UNRUNNABLE_FITS = frozenset({"oom"})


def _model_to_dict(m: ModelEntry,
                   installed: Optional[Set[str]] = None,
                   fit_by_model: Optional[dict] = None) -> dict:
    """One catalog row, annotated with whether it can actually be used.

    `unavailable_reason` is the important field. A model can be absent from
    the picker for three quite different reasons — not pulled, too big for
    this box, or switched off by the admin — and collapsing them into a bare
    `available: false` produces the "why can't I pick this?" that sent us
    here. Each one now says which it is.
    """
    available: bool
    reason: Optional[str] = None

    if m.is_cloud:
        available = True  # gated by key + admin switch, applied by the caller
    elif installed is None:
        available = True  # Ollama unreachable — assume available rather than empty the picker
    else:
        # Match exact name or base name without tag (e.g. "mistral:7b" matches
        # "mistral:7b" or "mistral")
        model_base = m.model_id.split(":")[0]
        available = m.model_id in installed or any(
            n == m.model_id or n.split(":")[0] == model_base
            for n in installed
        )
        if not available:
            reason = "Not pulled — run: ollama pull " + m.model_id

    # Hardware verdict, for local models only. A model that is installed but
    # cannot fit in GPU or RAM is worse than missing: selecting it produces a
    # load failure or swaps the machine to its knees, so it is reported
    # unavailable with the reason spelled out rather than offered and left to
    # fail at the first message.
    fit = (fit_by_model or {}).get(m.model_id) if not m.is_cloud else None
    if fit:
        if fit.get("status") in _UNRUNNABLE_FITS:
            available = False
            reason = "Unavailable at this time — " + (fit.get("reason") or "too large for this machine.")
        elif available and fit.get("status") == "ram_fallback":
            # Runnable, just slow. Still selectable — the note is the warning.
            reason = fit.get("reason")

    return {
        "provider": m.provider,
        "model_id": m.model_id,
        "display_name": m.display_name,
        "context_window": m.context_window,
        "is_cloud": m.is_cloud,
        "vram_gb": m.vram_gb,
        "cost_per_1k_input_usd": m.cost_per_1k_input_usd,
        "cost_per_1k_output_usd": m.cost_per_1k_output_usd,
        "notes": m.notes,
        "priority": m.priority,
        "available": available,
        "unavailable_reason": reason,
        "fit_status": (fit or {}).get("status"),
    }


#: Cached (monotonic_timestamp, fit_map). GPU headroom moves on the timescale
#: of minutes, and /api/models is hit by the model picker and the settings
#: page on every open — probing per request bought nothing and cost a
#: subprocess spawn each time.
_fit_cache: tuple = (0.0, {})
_FIT_TTL_SECONDS = 60.0


async def _hardware_fit_map() -> dict:
    """Model id -> {status, reason} for local models on this machine.

    Async and off-thread on purpose. `detect_hardware()` shells out to
    nvidia-smi and reads /proc; run inline it blocks the event loop for the
    length of a subprocess spawn, on a route two different pages poll.

    Skipped entirely when the hardware cookbook feature is off — the admin
    endpoint that exposes these verdicts already 404s in that case, so
    probing anyway did work nobody could see.

    Best effort throughout: a probe failure degrades to "no verdict" rather
    than taking down the model list.
    """
    global _fit_cache
    if not getattr(get_settings(), "hardware_cookbook_enabled", False):
        return {}

    now = time.monotonic()
    cached_at, cached = _fit_cache
    if cached and (now - cached_at) < _FIT_TTL_SECONDS:
        return cached

    def _probe() -> dict:
        from core.hardware_cookbook import detect_hardware, score_models

        return {
            row["model_id"]: {"status": row.get("status"), "reason": row.get("reason")}
            for row in score_models(detect_hardware())
        }

    try:
        result = await asyncio.to_thread(_probe)
    except Exception as exc:
        logger.debug("hardware fit probe unavailable: %s", exc)
        return {}
    _fit_cache = (now, result)
    return result


# nvidia_nim keeps its original standalone key so an existing deployment's
# saved setting is not silently reset by this generalisation. Everything else
# lives in the `provider_user_access` map.
_LEGACY_USER_ACCESS_KEYS = {"nvidia_nim": "nvidia_nim_user_access"}

#: Every provider is gateable, in the order the admin UI and the model picker
#: present them. Local first, then the free cloud tier, then the metered ones
#: cheapest-first.
#:
#: Being free buys a provider no exemption. An earlier version gated only the
#: paid providers on the theory that a zero-cost model is harmless — but cost
#: is not the only reason to close one off. A local model that thrashes a
#: 4 GB card, or a hosted model whose answers are not wanted in this house,
#: needs the same switch, and a toggle that silently does nothing for half
#: the list is worse than no toggle at all.
_USER_GATED_PROVIDERS = (
    "ollama",
    "nvidia_nim",
    "qwen",
    "deepseek",
    "anthropic",
    "openai",
    "gemini",
    "mistral_ai",
    "bedrock",
)

#: Presentation order for providers, used by the admin toggles and the picker.
PROVIDER_ORDER = _USER_GATED_PROVIDERS


def get_provider_user_access(admin_config: Optional[dict] = None) -> dict:
    """Which gated providers non-admin accounts may select models from."""
    admin_config = admin_config or {}
    stored = admin_config.get("provider_user_access") or {}
    access = {}
    for provider in _USER_GATED_PROVIDERS:
        legacy_key = _LEGACY_USER_ACCESS_KEYS.get(provider)
        default = admin_config.get(legacy_key, True) if legacy_key else True
        access[provider] = bool(stored.get(provider, default))
    return access


#: Where each provider's API key lives on Settings.
_PROVIDER_KEY_ATTR = {
    "nvidia_nim": "nvidia_api_key",
    "qwen": "qwen_api_key",
    "deepseek": "deepseek_api_key",
    "anthropic": "anthropic_api_key",
    "openai": "openai_api_key",
    "gemini": "gemini_api_key",
    "mistral_ai": "mistral_api_key",
}

#: The .env flag backing each provider's global switch, used as the default
#: when an admin has never touched the toggle.
_PROVIDER_ENV_FLAG = {
    "nvidia_nim": "nvidia_nim_enabled",
    "qwen": "qwen_enabled",
    "deepseek": "deepseek_enabled",
    "anthropic": "anthropic_enabled",
    "openai": "openai_enabled",
    "gemini": "gemini_enabled",
    "mistral_ai": "mistral_ai_enabled",
    "bedrock": "bedrock_enabled",
}

LOCAL_PROVIDERS = frozenset({"ollama"})


def _has_credentials(provider: str, s) -> bool:
    """Whether the deployment holds what this provider needs to answer at all.

    Separate from the admin's switches on purpose: "off because nobody
    configured a key" and "off because the admin said no" are different
    states, and the UI has to be able to tell them apart, or every disabled
    provider reads to the admin as a missing key they need to go find.
    """
    if provider in LOCAL_PROVIDERS:
        return True          # local daemon; per-model availability handled below
    if provider == "bedrock":
        return bool(s.aws_access_key_id) and bool(s.aws_secret_access_key)
    return bool(getattr(s, _PROVIDER_KEY_ATTR.get(provider, ""), ""))


def get_provider_global_enabled(admin_config: Optional[dict] = None) -> dict:
    """The admin's per-provider on/off switch, independent of credentials.

    Reads `provider_enabled` first, then the older per-provider keys, then
    the coarse local/cloud kill switches, then the .env flag. That chain
    exists so an existing deployment's saved choices survive: none of the
    older keys are dropped, they are just no longer the only way to say it.
    """
    s = get_settings()
    admin_config = admin_config or {}
    stored = admin_config.get("provider_enabled") or {}

    local_enabled = admin_config.get("local_llms_enabled_global", True)
    cloud_enabled = admin_config.get("cloud_llms_enabled_global", True)

    out = {}
    for provider in _USER_GATED_PROVIDERS:
        if provider in stored:
            resolved = bool(stored[provider])
        elif admin_config.get(f"{provider}_enabled_global") is not None:
            resolved = bool(admin_config[f"{provider}_enabled_global"])
        elif provider in LOCAL_PROVIDERS:
            resolved = bool(local_enabled)
        else:
            resolved = bool(getattr(s, _PROVIDER_ENV_FLAG.get(provider, ""), False))

        # The coarse kill switches are applied AFTER the chain resolves, not
        # inside its last branch. Previously they lived only in the `else`,
        # so the two earlier branches returned before ever consulting them —
        # and set_provider_switch writes both `provider_enabled[p]` and
        # `{p}_enabled_global` for every flip. One toggle of any provider
        # therefore put it permanently in an earlier branch, after which
        # "disable all cloud LLMs" silently stopped applying to it. A kill
        # switch that stops working once you use the panel next to it is
        # worse than no kill switch.
        coarse = local_enabled if provider in LOCAL_PROVIDERS else cloud_enabled
        out[provider] = resolved and bool(coarse)
    return out


def get_provider_switch_sources(admin_config: Optional[dict] = None) -> dict:
    """Where each provider's resolved switch value actually came from.

    Mirrors the resolution chain in `get_provider_global_enabled` exactly.
    Without it the admin UI had no way to tell an explicit choice from an
    inherited default, so it labelled every off provider "Blocked by you" —
    including the ones nobody had ever touched, which are off because .env
    says so. Following that label to the toggle and flipping it appears to do
    nothing on a fresh deployment, because the block being reported was never
    the admin's to begin with.

    One of: "admin" (this account set it), "env" (the .env flag's default),
    "coarse" (the local/cloud kill switch overrode an otherwise-on provider).
    """
    admin_config = admin_config or {}
    stored = admin_config.get("provider_enabled") or {}
    local_enabled = admin_config.get("local_llms_enabled_global", True)
    cloud_enabled = admin_config.get("cloud_llms_enabled_global", True)

    out = {}
    for provider in _USER_GATED_PROVIDERS:
        if provider in stored or admin_config.get(
                f"{provider}_enabled_global") is not None:
            source = "admin"
        else:
            # Local providers have no .env flag of their own; untouched, they
            # follow the coarse switch, which the check below reports.
            source = "env"

        # The coarse kill switch is applied last and beats whatever the chain
        # resolved, so when it is the thing holding a provider down it is the
        # thing to report.
        coarse = local_enabled if provider in LOCAL_PROVIDERS else cloud_enabled
        if not coarse:
            source = "coarse"
        out[provider] = source
    return out


def _cloud_unavailable_reason(provider: str, switches: dict) -> Optional[str]:
    """Why a cloud provider cannot be used, or None when it can.

    The admin's switch is reported ahead of the missing key: if they turned
    it off, telling them to go find an API key sends them after the wrong
    problem.
    """
    if not switches.get(provider, False):
        return "Disabled by the administrator."
    if not _has_credentials(provider, get_settings()):
        return "Missing API key."
    return None


def _get_enabled_providers(admin_config: Optional[dict] = None) -> dict:
    """Providers that can actually serve a request right now.

    A provider is usable only when the admin's switch is on AND the
    credentials exist. Both halves are required, which is why the two are
    computed separately above.
    """
    s = get_settings()
    switches = get_provider_global_enabled(admin_config)
    return {
        provider: bool(switches.get(provider)) and _has_credentials(provider, s)
        for provider in _USER_GATED_PROVIDERS
    }


async def _catalog_context(request: Request, is_admin: bool) -> dict:
    """Everything the "can this account use this model" question needs.

    Both the catalog and the saved-selection check have to answer that
    question, and they used to answer it in two places. That is how the
    picker could stop offering a model while GET /settings/llm went on
    handing the same model back as the current selection, leaving the user
    with a model button naming something that fails at send time.
    """
    installed = _get_ollama_installed_models()

    hidden_llms: set[str] = set()
    family_overrides: dict = {}
    user_access: dict = get_provider_user_access()
    switches: dict = get_provider_global_enabled()
    enabled: dict = _get_enabled_providers()
    try:
        config = await request.app.state.memory_manager._store.get_admin_config()
        hidden_llms = set(config.get("hidden_llms", []))
        family_overrides = config.get("model_families", {}) or {}
        user_access = get_provider_user_access(config)
        switches = get_provider_global_enabled(config)
        enabled = _get_enabled_providers(config)
    except Exception as exc:
        # A failed policy read must not widen access. The defaults computed
        # above grant every provider to everyone, so silently continuing on
        # them served a restricted household member the full metered catalog
        # — the store erroring was all it took to lift the restriction.
        logger.warning(
            "Could not read admin config for the model catalog; "
            "denying gated providers to non-admins: %s", exc,
        )
        if not is_admin:
            user_access = {p: False for p in _USER_GATED_PROVIDERS}

    # Non-admins cannot see a gated provider's models unless access is granted.
    # Admins always retain access, so a household member cannot reach a
    # provider the admin has closed, while the admin can still test it.
    if not is_admin:
        for provider, allowed in user_access.items():
            if not allowed:
                hidden_llms = hidden_llms | {
                    m.model_id for m in LLMRegistry.list_by_provider(provider)}

    return {
        "is_admin": is_admin,
        "installed": installed,
        "enabled": enabled,
        "switches": switches,
        "user_access": user_access,
        "hidden_llms": hidden_llms,
        "family_overrides": family_overrides,
    }


def _annotate(m: ModelEntry, ctx: dict,
              fit_by_model: Optional[dict] = None) -> dict:
    """One catalog row with the provider-level gates applied on top.

    `_model_to_dict` knows about the model — pulled, too big for this box.
    The admin's switches and the credentials live out here, and folding them
    in has to happen identically everywhere the answer is needed.
    """
    if m.is_cloud:
        return {
            **_model_to_dict(m),
            "available": ctx["enabled"].get(m.provider, False),
            "unavailable_reason": _cloud_unavailable_reason(
                m.provider, ctx["switches"]),
        }

    row = _model_to_dict(m, ctx["installed"], fit_by_model)
    # A local provider switched off by the admin is unavailable for the same
    # reason a keyless cloud one is, and must say so — "free" is not a reason
    # to escape the switch.
    if not ctx["enabled"].get(m.provider, True):
        return {
            **row,
            "available": False,
            "unavailable_reason": "Disabled by the administrator.",
        }
    return row


def _first_usable_free_model(
        ctx: dict, fit_by_model: Optional[dict] = None) -> tuple:
    """A free model this account can use right now, or (None, None).

    Deliberately free-only. This backs the automatic substitution made when a
    saved selection has gone unusable, and a substitution the user did not ask
    for must never be one that bills them. If nothing free is left, the caller
    reports the problem and lets them choose instead.
    """
    for m in LLMRegistry.list_local():
        if m.model_id in ctx["hidden_llms"]:
            continue
        if _annotate(m, ctx, fit_by_model).get("available"):
            return m.provider, m.model_id

    by_provider: dict = {}
    for m in LLMRegistry.list_cloud():
        by_provider.setdefault(m.provider, []).append(m)
    for provider in PROVIDER_ORDER:
        for m in by_provider.get(provider, []):
            if m.model_id in ctx["hidden_llms"]:
                continue
            if not LLMRegistry.is_free(provider, m.model_id):
                continue
            if _annotate(m, ctx).get("available"):
                return m.provider, m.model_id
    return None, None


def _selection_status(provider: str, model_id: str, ctx: dict,
                      fit_by_model: Optional[dict] = None) -> tuple:
    """Whether a saved selection can still serve a message, and why not."""
    if provider == "auto":
        # Auto has no single model to check; it is usable while the router
        # has anything at all to route to.
        chosen, _ = _first_usable_free_model(ctx, fit_by_model)
        if chosen:
            return True, None
        return False, "No models are available."

    if model_id in ctx["hidden_llms"]:
        return False, "Hidden by the administrator."

    entry = LLMRegistry.get(provider, model_id)
    if entry is None:
        return False, "No longer in the model catalog."

    row = _annotate(entry, ctx, fit_by_model)
    if row.get("available"):
        return True, None
    return False, row.get("unavailable_reason") or "Unavailable."


async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload: Optional[dict] = await decode_token(
        authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    return payload["sub"]


async def _require_admin(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload: Optional[dict] = await decode_token(
        authorization.removeprefix("Bearer "))
    if not payload or payload.get("role") != "admin":
        raise forbidden("Admin role required.")
    return payload["sub"]


# =============================================================================
# GET /api/models
# =============================================================================

@router.get("/models")
async def list_models(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Return the LLM model catalog split into local and cloud sections.
    Local models include an `available` flag based on what Ollama has pulled.
    Cloud models include an `available` flag based on configured API keys.
    """
    await _require_user(authorization)
    is_admin = False
    try:
        tok = (authorization or "").removeprefix("Bearer ")
        p = await decode_token(tok)
        is_admin = p.get("role") == "admin" if p else False
    except Exception:
        pass

    ctx = await _catalog_context(request, is_admin)
    fit_by_model = await _hardware_fit_map()

    local_models = [
        _annotate(m, ctx, fit_by_model)
        for m in LLMRegistry.list_local()
        if m.model_id not in ctx["hidden_llms"]
    ]
    cloud_models = [
        _annotate(m, ctx)
        for m in LLMRegistry.list_cloud()
        if m.model_id not in ctx["hidden_llms"]
    ]

    return {
        "local": local_models,
        "cloud": cloud_models,
        "enabled_providers": ctx["enabled"],
        "provider_user_access": ctx["user_access"],
        "provider_enabled": ctx["switches"],
        "provider_order": list(PROVIDER_ORDER),
        "ollama_reachable": bool(ctx["installed"]) or True,
        "family_overrides": ctx["family_overrides"],
        # "River Decides" is offered in the picker whether or not the router
        # is on. With it off, provider="auto" resolves to the local default
        # rather than routing anything, so the picker needs to know in order
        # to stop describing it as automatic model choice.
        "intent_router_enabled": bool(
            getattr(get_settings(), "model_intent_router_enabled", False)),
    }


# =============================================================================
# GET /api/models/hardware  — Hardware Cookbook (admin, flag-gated)
# =============================================================================

@router.get("/models/hardware")
async def get_hardware_cookbook(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Detect host GPU/RAM/CPU and score every local model as fits / tight /
    ram_fallback / oom. Admin-only. Returns 404 when the feature flag
    `hardware_cookbook_enabled` is False, so the UI can hide the section
    cleanly without leaking its existence.
    """
    await _require_admin(authorization)
    settings = get_settings()
    if not getattr(settings, "hardware_cookbook_enabled", False):
        raise not_found("Hardware Cookbook is disabled.")

    from core.hardware_cookbook import build_cookbook
    return build_cookbook()


# =============================================================================
# User Preferences (General)
# =============================================================================

class UserPreferencesSchema(BaseModel):
    music_provider: Literal["youtube_music",
                            "spotify", "none"] = "youtube_music"
    voice_toggle: Literal["auto", "always", "never"] = "auto"


@router.get("/settings", response_model=UserPreferencesSchema)
async def get_user_preferences_route(
        request: Request, authorization: Optional[str] = Header(default=None)):
    """Return the general user preferences (music provider, etc.)."""
    user_id = await _require_user(authorization)
    store = request.app.state.memory_manager._store
    prefs = await store.get_user_preferences(user_id)
    return UserPreferencesSchema(music_provider=prefs.music_provider, voice_toggle=prefs.voice_toggle)


@router.post("/settings")
async def save_user_preferences_route(
    request: Request,
    body: UserPreferencesSchema,
    authorization: Optional[str] = Header(default=None),
):
    """Save the general user preferences."""
    user_id = await _require_user(authorization)
    store = request.app.state.memory_manager._store

    from providers.memory.models import UserPreferences as UserPrefsModel
    prefs = UserPrefsModel(user_id=user_id, music_provider=body.music_provider, voice_toggle=body.voice_toggle)

    try:
        await store.save_user_preferences(prefs)
        return {"success": True}
    except Exception as exc:
        logger.error("Failed to save user preferences: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to save preferences.")


# =============================================================================
# LLM settings
# =============================================================================

class LLMSettingsBody(BaseModel):
    provider: str
    model_id: str
    # None = "don't touch fallback" (e.g. a plain model pick). Only the
    # admin Cloud Fallback panel sends these explicitly.
    cloud_fallback_enabled: Optional[bool] = None
    cloud_fallback_provider: Optional[str] = None
    cloud_fallback_model: Optional[str] = None
    whisper_model: str = "base"


@router.get("/settings/llm")
async def get_llm_settings(
        request: Request, authorization: Optional[str] = Header(default=None)):
    """Return the current LLM provider + model selection for a user.

    The selection is re-checked against the gates on every read rather than
    trusted because it was valid when it was saved. An admin switching a
    provider off, closing it to non-admins, or hiding a model does not touch
    anyone's stored choice, so the stale selection used to come back looking
    perfectly ordinary and fail at send time with "disabled globally by the
    administrator" — the first hint anything had changed.

    The stored value is reported as-is and never rewritten here: the admin
    may turn the provider back on tomorrow, and the user should get their
    model back when they do rather than having been quietly migrated off it.
    """
    user_id = await _require_user(authorization)
    memory = request.app.state.memory_manager
    s = await memory.get_llm_settings(user_id)

    is_admin = False
    try:
        payload = await decode_token((authorization or "").removeprefix("Bearer "))
        is_admin = bool(payload) and payload.get("role") == "admin"
    except Exception:
        pass

    # Get display name from registry
    entry = LLMRegistry.get(s.provider, s.model)
    display_name = entry.display_name if entry else s.model

    available = True
    unavailable_reason: Optional[str] = None
    fallback_provider: Optional[str] = None
    fallback_model: Optional[str] = None
    fallback_display_name: Optional[str] = None
    try:
        ctx = await _catalog_context(request, is_admin)
        fit_by_model = await _hardware_fit_map()
        available, unavailable_reason = _selection_status(
            s.provider, s.model, ctx, fit_by_model)
        if not available:
            fallback_provider, fallback_model = _first_usable_free_model(
                ctx, fit_by_model)
            if fallback_provider:
                fb = LLMRegistry.get(fallback_provider, fallback_model)
                fallback_display_name = fb.display_name if fb else fallback_model
    except Exception as exc:
        # The selection itself is the answer to this route. A gating read
        # that falls over should not turn a working model button into an
        # error, so report the stored choice unannotated and let the send
        # path be the thing that refuses.
        logger.warning(
            "Could not revalidate the saved LLM selection for %s: %s",
            user_id, exc,
        )

    return {
        "provider": s.provider,
        "model": s.model,
        "display_name": display_name,
        "available": available,
        "unavailable_reason": unavailable_reason,
        "fallback_provider": fallback_provider,
        "fallback_model": fallback_model,
        "fallback_display_name": fallback_display_name,
        "cloud_fallback_enabled": s.cloud_fallback_enabled,
        "cloud_fallback_provider": s.cloud_fallback_provider,
        "cloud_fallback_model": s.cloud_fallback_model,
        "whisper_model": s.whisper_model,
    }


# Cloud fallback is admin-controlled and limited to Anthropic + Gemini.
_FALLBACK_PROVIDERS = {"anthropic", "gemini"}


@router.post("/settings/llm")
async def save_llm_settings(
    request: Request,
    body: LLMSettingsBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)

    # Is the caller an admin? Cloud fallback activation is admin-only.
    is_admin = False
    try:
        tok = (authorization or "").removeprefix("Bearer ")
        payload = await decode_token(tok)
        is_admin = bool(payload) and payload.get("role") == "admin"
    except Exception:
        is_admin = False

    admin_config = await request.app.state.memory_manager._store.get_admin_config()

    # "auto" = River decides per-message via the model intent router. It is a
    # routing mode, not a catalog entry, so it skips the registry lookup.
    if body.provider == "auto":
        entry = None
        normalized_model = "auto"
    else:
        entry = LLMRegistry.get(body.provider, body.model_id)
        if not entry:
            raise bad_request(f"Unknown model '{body.model_id}' for provider '{body.provider}'. "
                              f"Check /api/models for valid options.")
        normalized_model = body.model_id

        # Validate against the SAME state /api/models lists from: admin global
        # toggles + per-model visibility, not just .env keys. Otherwise a user
        # can save a model that the picker will never show.
        hidden = set(admin_config.get("hidden_llms", []))
        if body.model_id in hidden:
            raise bad_request(
                f"Model '{body.model_id}' is hidden by the administrator.")

        # Applies to local models too. A disabled Ollama used to be saveable
        # because the check was behind `if entry.is_cloud`, which made the
        # local switch decorative.
        enabled = _get_enabled_providers(admin_config)
        if not enabled.get(body.provider, False):
            raise bad_request(f"Provider '{body.provider}' is disabled (admin toggle, "
                              f"{body.provider.upper()}_ENABLED, or missing API key).")

        # Per-provider user access. Without this the gate is cosmetic: the
        # provider's models are merely absent from /api/models, and anyone who
        # knows a model id can still save it here and start spending on it.
        if not is_admin:
            access = get_provider_user_access(admin_config)
            if not access.get(body.provider, True):
                raise forbidden(
                    f"Your account is not permitted to use {body.provider} models. "
                    f"Ask an administrator to enable access."
                )

    # ----- Cloud fallback: admin-only, Anthropic/Gemini only -----
    # Always start from the persisted state. Non-fallback saves (plain model
    # pick, Whisper change) preserve it untouched. Only an actual *change* to
    # the fallback config requires admin + validation.
    memory = request.app.state.memory_manager
    existing = await memory.get_llm_settings(user_id)
    fallback_enabled = existing.cloud_fallback_enabled
    fallback_provider = existing.cloud_fallback_provider
    fallback_model = existing.cloud_fallback_model

    if body.cloud_fallback_enabled is not None:
        req_enabled = body.cloud_fallback_enabled
        req_provider = body.cloud_fallback_provider if req_enabled else None
        req_model = body.cloud_fallback_model if req_enabled else None
        changed = (
            req_enabled != fallback_enabled
            or req_provider != fallback_provider
            or req_model != fallback_model
        )
        if changed:
            if not is_admin:
                raise forbidden(
                    "Only an administrator can change cloud fallback settings.")
            if req_enabled:
                if req_provider not in _FALLBACK_PROVIDERS:
                    raise bad_request(
                        "Cloud fallback supports only Anthropic Claude and Google Gemini.")
                fb_enabled_map = _get_enabled_providers(admin_config)
                if not fb_enabled_map.get(req_provider, False):
                    raise bad_request(
                        f"Fallback provider '{req_provider}' is disabled "
                        f"({req_provider.upper()}_ENABLED or missing API key).")
                if req_model and not LLMRegistry.get(req_provider, req_model):
                    raise bad_request(
                        f"Unknown fallback model '{req_model}' for '{req_provider}'.")
            fallback_enabled = req_enabled
            fallback_provider = req_provider
            fallback_model = req_model

    memory = request.app.state.memory_manager
    settings = LLMSettings(
        user_id=user_id,
        provider=body.provider,
        model=normalized_model,
        cloud_fallback_enabled=fallback_enabled,
        cloud_fallback_provider=fallback_provider,
        cloud_fallback_model=fallback_model,
        whisper_model=body.whisper_model,
    )
    await memory.save_llm_settings(settings)

    def _strip(s): return str(s).replace(
        "\r",
        "").replace(
        "\n",
        "").replace(
            "\t",
        "")
    logger.info(
        "LLM settings saved (user=%s, provider=%s, model=%s).",
        _strip(user_id),
        _strip(
            body.provider),
        _strip(normalized_model))
    return {"status": "ok", "provider": body.provider, "model": normalized_model}


# =============================================================================
# Model families (Phase B — admin override of Chat selector families)
# =============================================================================

class ModelFamiliesBody(BaseModel):
    # families is a free-form dict keyed by family id (e.g. "deepseek"):
    #   { enabled: bool, quirky_name: str|null, tiers: {fast?, thinking?, pro?} }
    # Tier values are model_id strings or null (= use default from
    # modelFamilies.js).
    families: dict


@router.get("/settings/model-families")
async def get_model_families(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Return the admin-configured family overrides. Empty dict if none set."""
    await _require_admin(authorization)
    try:
        config = await request.app.state.memory_manager._store.get_admin_config()
        return {"families": config.get("model_families", {}) or {}}
    except Exception as e:
        logger.warning("Failed to load model_families config: %s", e)
        return {"families": {}}


@router.post("/settings/model-families")
async def save_model_families(
    request: Request,
    body: ModelFamiliesBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_admin(authorization)
    try:
        store = request.app.state.memory_manager._store
        config = await store.get_admin_config()
        config["model_families"] = body.families
        await store.set_admin_config(config)
    except Exception as e:
        logger.error("Failed to persist model_families: %s", e)
        raise HTTPException(status_code=500,
                            detail="Failed to persist model families.")

    logger.info("Model family overrides saved by admin %s (count=%d).",
                str(user_id).replace(
                    "\r",
                    "").replace(
                    "\n",
                    "").replace(
                    "\t",
                    ""),
                len(body.families))
    return {"ok": True}


# =============================================================================
# Memory settings
# =============================================================================

class MemorySettingsBody(BaseModel):
    summaries_enabled: bool = True
    default_ttl: str = "standard"
    auto_extend: bool = True


@router.get("/settings/memory")
async def get_memory_settings(
        request: Request, authorization: Optional[str] = Header(default=None)):
    """Return the current memory settings for a user."""
    user_id = await _require_user(authorization)
    memory = request.app.state.memory_manager
    s = await memory.get_memory_settings(user_id)
    return {
        "summaries_enabled": s.summaries_enabled,
        "default_ttl": s.default_ttl,
        "auto_extend": s.auto_extend,
        "ttl_options": TTLOption.ALL,
    }


@router.post("/settings/memory")
async def save_memory_settings(
    request: Request,
    body: MemorySettingsBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    if not TTLOption.is_valid(body.default_ttl):
        raise bad_request(
            f"Invalid TTL '{
                body.default_ttl}'. Valid options: {
                TTLOption.ALL}")

    memory = request.app.state.memory_manager
    settings = MemorySettings(
        user_id=user_id,
        summaries_enabled=body.summaries_enabled,
        default_ttl=body.default_ttl,
        auto_extend=body.auto_extend,
    )
    await memory.save_memory_settings(settings)
    logger.info(
        "Memory settings saved (user=%s).",
        str(user_id).replace(
            "\r",
            "").replace(
            "\n",
            "").replace(
                "\t",
            ""))
    return {"status": "ok"}


# =============================================================================
# Voice / TTS settings
# =============================================================================

@router.get("/settings/voice")
async def get_voice_settings(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Return the active TTS provider, the full voice registry, and which voices
    are installed on disk. Active voice is read from per-user SQLite settings.
    """
    user_id = await _require_user(authorization)
    settings = get_settings()
    provider = settings.tts_provider
    model_path = settings.piper_model_path

    from providers.tts.voice_registry import VoiceRegistry
    import os

    model_dir = os.path.dirname(model_path) if model_path else ""

    # Read active voice from per-user DB (falls back to system default)
    active_voice_id = getattr(settings, "active_voice_id", "river") or "river"
    try:
        mm = getattr(request.app.state, "memory_manager", None)
        if mm and user_id != "default":
            row = await mm._store.get_llm_settings(user_id)
            if row.voice_id:
                active_voice_id = row.voice_id
    except Exception:
        pass

    # Check kokoro once — requires Python <3.13; skip all kokoro voices if
    # unavailable
    try:
        import kokoro  # noqa: F401
        kokoro_available = True
    except ImportError:
        kokoro_available = False

    hidden_voices: set[str] = set()
    try:
        config = await request.app.state.memory_manager._store.get_admin_config()
        hidden_voices = set(config.get("hidden_voices", []))
    except Exception:
        pass

    # Build the voice list from the registry, annotating installed/active
    # status
    voices = []
    for entry in VoiceRegistry.list_all():
        if entry.voice_id in hidden_voices:
            continue
        if entry.engine == "kokoro":
            if not kokoro_available:
                continue
            installed = True
            path = None
        else:
            # Piper voices: check for the .onnx file on disk
            installed_path = os.path.join(
                model_dir, entry.filename) if model_dir and entry.filename else ""
            installed = bool(installed_path and os.path.exists(installed_path))
            path = installed_path if installed else None

        active = entry.voice_id == active_voice_id

        voices.append({
            "voice_id": entry.voice_id,
            "display_name": entry.display_name,
            "engine": entry.engine,
            "filename": entry.filename,
            "lang": entry.lang,
            "accent": entry.accent,
            "gender": entry.gender,
            "quality": entry.quality,
            "size_mb": entry.size_mb,
            "description": entry.description,
            "default": entry.default,
            "installed": installed,
            "active": active,
            "path": path,
        })

    active_entry = next((v for v in voices if v["active"]), None)
    active_name = active_entry["display_name"] if active_entry else (
        active_voice_id or "None")
    active_engine = active_entry["engine"] if active_entry else provider
    provider_labels = {
        "piper": "Piper (local binary)",
        "kokoro": "Kokoro (neural, CPU)",
        "none": "Disabled",
    }

    return {
        "provider": active_engine,
        "provider_label": provider_labels.get(str(active_engine), str(active_engine)),
        "active_voice": active_name,
        "active_path": model_path,
        "active_voice_id": active_voice_id,
        "voices": voices,
    }


class VoiceSwitchBody(BaseModel):
    voice_id: str


@router.post("/settings/voice")
async def set_active_voice(
    body: VoiceSwitchBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Switch the active voice — saved to SQLite per user, takes effect on
    the next conversation (new WebSocket connection). No restart required.
    """
    user_id = await _require_user(authorization)
    settings = get_settings()

    from providers.tts.voice_registry import VoiceRegistry
    import os

    entry = VoiceRegistry.get(body.voice_id)
    if not entry:
        raise not_found(f"Unknown voice ID: {body.voice_id}")

    # The admin's voice toggle was enforced only when listing voices, so a
    # hidden voice was merely absent from the picker — anyone who knew the id
    # could still set it here. Same cosmetic gate the model toggles had.
    try:
        admin_config = await request.app.state.memory_manager._store.get_admin_config()
        hidden_voices = set(admin_config.get("hidden_voices", []))
    except Exception:
        hidden_voices = set()
    if body.voice_id in hidden_voices:
        raise forbidden(
            f"Voice '{entry.display_name}' has been disabled by the administrator.")

    # Piper voices need the .onnx file on disk
    if entry.engine == "piper":
        model_dir = os.path.dirname(
            settings.piper_model_path) if settings.piper_model_path else ""
        if not model_dir:
            raise HTTPException(status_code=500,
                                detail="PIPER_MODEL_PATH not configured.")
        new_piper_path = os.path.join(model_dir, entry.filename)
        if not os.path.exists(new_piper_path):
            raise not_found(f"{entry.display_name} is not installed. "
                            f"Run: python scripts/download_voices.py {entry.voice_id}")

    # Save voice_id to SQLite (same store as LLM settings)
    mm = getattr(request.app.state, "memory_manager", None)
    if mm:
        store = mm._store
        current = await store.get_llm_settings(user_id)
        current.voice_id = entry.voice_id
        await store.save_llm_settings(current)

    logger.info(
        "Voice switched to %s (%s) [%s]",
        entry.display_name,
        entry.voice_id,
        entry.engine)
    return {
        "ok": True,
        "voice_id": entry.voice_id,
        "display_name": entry.display_name,
        "engine": entry.engine,
        "note": "Active on your next conversation.",
    }


# =============================================================================
# Intent Router settings
# =============================================================================

class NvidiaUserAccessBody(BaseModel):
    enabled: bool


@router.get("/settings/nvidia-nim-access")
async def get_nvidia_nim_access(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(authorization)
    try:
        config = await request.app.state.memory_manager._store.get_admin_config()
        return {"enabled": config.get("nvidia_nim_user_access", True)}
    except Exception:
        return {"enabled": True}


@router.post("/settings/nvidia-nim-access")
async def set_nvidia_nim_access(
    request: Request,
    body: NvidiaUserAccessBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_admin(authorization)
    try:
        store = request.app.state.memory_manager._store
        config = await store.get_admin_config()
        config["nvidia_nim_user_access"] = body.enabled
        # Keep the generalised map in step, or the two would disagree and
        # whichever the reader consults would decide the answer.
        access = config.get("provider_user_access") or {}
        access["nvidia_nim"] = body.enabled
        config["provider_user_access"] = access
        await store.set_admin_config(config)
    except Exception as e:
        logger.warning("Failed to persist nvidia_nim_user_access: %s", e)
    logger.info(
        "NIM user access set to %s by admin %s.",
        body.enabled,
        user_id)
    return {"ok": True, "enabled": body.enabled}


# -----------------------------------------------------------------------------
# Per-provider user access — the generalisation of the NIM toggle above
# -----------------------------------------------------------------------------

class ProviderUserAccessBody(BaseModel):
    provider: str
    enabled: bool


@router.get("/settings/provider-user-access")
async def get_provider_user_access_route(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Which gated providers non-admins may pick models from."""
    await _require_admin(authorization)
    try:
        config = await request.app.state.memory_manager._store.get_admin_config()
        return {"access": get_provider_user_access(config)}
    except Exception:
        return {"access": get_provider_user_access()}


@router.post("/settings/provider-user-access")
async def set_provider_user_access(
    request: Request,
    body: ProviderUserAccessBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_admin(authorization)
    if body.provider not in _USER_GATED_PROVIDERS:
        raise bad_request(
            f"Unknown gated provider '{body.provider}'. "
            f"Expected one of: {', '.join(_USER_GATED_PROVIDERS)}."
        )
    try:
        store = request.app.state.memory_manager._store
        config = await store.get_admin_config()
        access = config.get("provider_user_access") or {}
        access[body.provider] = body.enabled
        config["provider_user_access"] = access
        # Mirror back to the legacy key so an older client reading it, or a
        # rollback to a previous build, still sees the admin's real choice.
        legacy_key = _LEGACY_USER_ACCESS_KEYS.get(body.provider)
        if legacy_key:
            config[legacy_key] = body.enabled
        await store.set_admin_config(config)
    except Exception as e:
        # Returning ok:True here showed the admin their new setting as saved
        # while the stored policy was unchanged — for an access control that
        # decides who can spend money, that is the worst possible failure
        # mode: they close it, see it closed, and it is open.
        logger.error("Failed to persist provider_user_access: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Could not save provider access. The previous setting is still in effect.",
        )
    logger.info(
        "User access for %s set to %s by admin %s.",
        body.provider,
        body.enabled,
        user_id,
    )
    return {"ok": True, "provider": body.provider, "enabled": body.enabled}


class ProviderEnabledBody(BaseModel):
    provider: str
    enabled: bool


@router.get("/admin/provider-switches")
async def get_provider_switches(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Every provider's two switches plus whether its credentials exist.

    One call so the admin UI can render the whole matrix without guessing
    which of "off" means "no key" and which means "I turned it off".
    """
    await _require_admin(authorization)
    try:
        config = await request.app.state.memory_manager._store.get_admin_config()
    except Exception:
        config = {}
    s = get_settings()
    switches = get_provider_global_enabled(config)
    access = get_provider_user_access(config)
    sources = get_provider_switch_sources(config)
    return {
        "order": list(PROVIDER_ORDER),
        "providers": [
            {
                "provider": p,
                "enabled": switches.get(p, False),
                "enabled_source": sources.get(p, "env"),
                "user_access": access.get(p, True),
                "has_credentials": _has_credentials(p, s),
                "is_local": p in LOCAL_PROVIDERS,
                "usable": switches.get(p, False) and _has_credentials(p, s),
            }
            for p in PROVIDER_ORDER
        ],
    }


@router.post("/admin/provider-switches")
async def set_provider_switch(
    request: Request,
    body: ProviderEnabledBody,
    authorization: Optional[str] = Header(default=None),
):
    """Flip one provider's global switch. Applies to local providers too."""
    user_id = await _require_admin(authorization)
    if body.provider not in _USER_GATED_PROVIDERS:
        raise bad_request(
            f"Unknown provider '{body.provider}'. "
            f"Expected one of: {', '.join(_USER_GATED_PROVIDERS)}."
        )
    try:
        store = request.app.state.memory_manager._store
        config = await store.get_admin_config()
        switches = config.get("provider_enabled") or {}
        switches[body.provider] = body.enabled
        config["provider_enabled"] = switches
        # Keep the coarse legacy keys in step so older readers agree.
        if body.provider in LOCAL_PROVIDERS:
            config["local_llms_enabled_global"] = body.enabled
        legacy = f"{body.provider}_enabled_global"
        config[legacy] = body.enabled
        await store.set_admin_config(config)
    except Exception as e:
        logger.error("Failed to persist provider switch: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Could not save the provider switch. The previous setting is still in effect.",
        )
    logger.info(
        "Provider %s globally %s by admin %s.",
        body.provider,
        "enabled" if body.enabled else "disabled",
        user_id,
    )
    return {"ok": True, "provider": body.provider, "enabled": body.enabled}


class LLMRoutingFlagsBody(BaseModel):
    local_enabled: bool
    cloud_enabled: bool
    nvidia_enabled: bool
    # Optional so an older frontend that posts only the original three fields
    # does not silently switch the metered providers off.
    deepseek_enabled: Optional[bool] = None
    qwen_enabled: Optional[bool] = None


@router.get("/admin/llm-routing-flags")
async def get_llm_routing_flags(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(authorization)
    try:
        config = await request.app.state.memory_manager._store.get_admin_config()
        from config.settings import get_settings
        s = get_settings()
        return {
            "local_enabled": config.get("local_llms_enabled_global", True),
            "cloud_enabled": config.get("cloud_llms_enabled_global", True),
            "nvidia_enabled": config.get("nvidia_nim_enabled_global", s.nvidia_nim_enabled),
            "deepseek_enabled": config.get("deepseek_enabled_global", s.deepseek_enabled),
            "qwen_enabled": config.get("qwen_enabled_global", s.qwen_enabled),
        }
    except Exception:
        return {"local_enabled": True, "cloud_enabled": True,
                "nvidia_enabled": False, "deepseek_enabled": False,
                "qwen_enabled": False}


@router.post("/admin/llm-routing-flags")
async def set_llm_routing_flags(
    request: Request,
    body: LLMRoutingFlagsBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_admin(authorization)
    try:
        store = request.app.state.memory_manager._store
        config = await store.get_admin_config()
        config["local_llms_enabled_global"] = body.local_enabled
        config["cloud_llms_enabled_global"] = body.cloud_enabled
        config["nvidia_nim_enabled_global"] = body.nvidia_enabled
        if body.deepseek_enabled is not None:
            config["deepseek_enabled_global"] = body.deepseek_enabled
        if body.qwen_enabled is not None:
            config["qwen_enabled_global"] = body.qwen_enabled
        await store.set_admin_config(config)
    except Exception as e:
        logger.warning("Failed to persist llm routing flags: %s", e)
    logger.info("LLM routing flags set by admin %s.", user_id)
    return {"ok": True}


class IntentRouterBody(BaseModel):
    enabled: bool
    min_hits: int = 2


@router.get("/settings/intent-router")
async def get_intent_router_settings(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Return the current model intent router configuration and its routes.

    `routes` is resolved against the live provider gates rather than listed
    from a fixed table, so the panel shows where each intent would actually
    land today — including the ones that have fallen through to a later
    preference because the first is switched off.
    """
    await _require_admin(authorization)
    s = get_settings()

    routes: list = []
    try:
        from providers.llm.model_intent_router import resolved_routes
        ctx = await _catalog_context(request, is_admin=True)
        routes = resolved_routes(ctx["enabled"], hidden_models=ctx["hidden_llms"])
    except Exception as exc:
        # The two switches are the point of this route; a preview that cannot
        # be built should not take them down with it.
        logger.warning("Could not resolve intent router routes: %s", exc)

    return {
        "enabled": s.model_intent_router_enabled,
        "min_hits": s.model_intent_router_min_hits,
        "routes": routes,
    }


@router.post("/settings/intent-router")
async def save_intent_router_settings(
    request: Request,
    body: IntentRouterBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_admin(authorization)
    s = get_settings()
    s.model_intent_router_enabled = body.enabled
    s.model_intent_router_min_hits = body.min_hits

    try:
        store = request.app.state.memory_manager._store
        config = await store.get_admin_config()
        config["intent_router_config"] = body.model_dump()
        await store.set_admin_config(config)
    except Exception as e:
        logger.warning("Failed to persist intent router settings: %s", e)

    logger.info("Intent router settings saved by admin %s.", user_id)
    return {"ok": True}


# =============================================================================
# Generic per-page settings  GET /api/settings/page  PATCH /api/settings/page
# =============================================================================

@router.get("/settings/page")
async def get_page_settings(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Return the full per-page settings blob for the current user."""
    user_id = await _require_user(authorization)
    store = request.app.state.memory_manager._store
    return await store.get_page_settings(user_id)


class PageSettingsPatch(BaseModel):
    class Config:
        extra = "allow"

    def to_dict(self) -> dict:
        return self.model_dump()


@router.patch("/settings/page")
async def patch_page_settings(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Deep-merge request body at the root key level into the user's page settings."""
    user_id = await _require_user(authorization)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Body must be a JSON object.")
    if not isinstance(body, dict):
        raise HTTPException(
            status_code=400,
            detail="Body must be a JSON object.")
    store = request.app.state.memory_manager._store
    await store.save_page_settings(user_id, body)
    return {"ok": True}


# =============================================================================
# Orchestration settings (Phase 9)
# =============================================================================

class OrchestrationSettingsBody(BaseModel):
    n8n_enabled: bool
    n8n_url: str
    n8n_api_key: str
    n8n_webhook_secret: str
    daemon_scribe_enabled: Optional[bool] = None


@router.get("/settings/orchestration")
async def get_orchestration_settings(
        request: Request, authorization: Optional[str] = Header(default=None)):
    """Return the current n8n + daemon orchestration settings."""
    await _require_user(authorization)
    s = get_settings()
    return {
        "n8n_enabled": s.n8n_enabled,
        "n8n_url": s.n8n_url,
        "n8n_api_key": s.n8n_api_key,
        "n8n_webhook_secret": s.n8n_webhook_secret,
        "daemon_scribe_enabled": s.daemon_scribe_enabled,
    }


@router.post("/settings/orchestration")
async def save_orchestration_settings(
    request: Request,
    body: OrchestrationSettingsBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    payload: Optional[dict] = await decode_token(
        authorization.removeprefix("Bearer ")) if authorization else None
    if not payload or payload.get("role") != "admin":
        raise forbidden("Only admins can modify orchestration settings.")

    s = get_settings()
    s.n8n_enabled = body.n8n_enabled
    s.n8n_url = body.n8n_url
    s.n8n_api_key = body.n8n_api_key
    s.n8n_webhook_secret = body.n8n_webhook_secret
    if body.daemon_scribe_enabled is not None:
        s.daemon_scribe_enabled = body.daemon_scribe_enabled

    logger.info("Orchestration settings saved by admin %s.", user_id)
    return {"status": "ok"}


@router.get("/tts/preview/{voice_id}")
async def preview_voice(
    voice_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """
    Synthesize the preview phrase for a given voice and return it as
    base64-encoded WAV audio. The frontend plays this directly in the browser.
    Works for both Piper (if installed) and Kokoro voices.
    """
    await _require_user(authorization)

    from providers.tts.voice_registry import VoiceRegistry
    import base64
    import os

    entry = VoiceRegistry.get(voice_id)
    if not entry:
        raise not_found(f"Unknown voice ID: {voice_id}")

    settings = get_settings()

    # Build a temporary provider for this specific voice
    try:
        if entry.engine == "kokoro":
            from providers.tts.kokoro_provider import KokoroTTS
            provider = KokoroTTS(voice_code=entry.voice_code)

        elif entry.engine == "piper":
            model_dir = os.path.dirname(
                settings.piper_model_path) if settings.piper_model_path else ""
            if not model_dir:
                raise HTTPException(
                    status_code=503,
                    detail="PIPER_MODEL_PATH not configured.")
            model_path = os.path.join(model_dir, entry.filename)
            if not os.path.exists(model_path):
                raise not_found(f"{entry.display_name} is not installed. "
                                f"Run: python scripts/download_voices.py {entry.voice_id}")
            from providers.tts.piper import PiperTTS
            # Override the model path for this preview only
            provider = PiperTTS(model_path_override=model_path)  # type: ignore

        else:
            raise bad_request(f"Unsupported engine: {entry.engine}")

        wav_bytes = await provider.synthesize(entry.preview_text)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Voice preview failed for %s: %s", voice_id, exc)
        raise HTTPException(status_code=502, detail=f"Synthesis failed: {exc}")

    if not wav_bytes:
        raise HTTPException(status_code=502, detail="No audio produced.")

    return {"audio_b64": base64.b64encode(wav_bytes).decode("utf-8")}

# =============================================================================
# ElevenLabs & Persona settings
# =============================================================================


class ElevenLabsBody(BaseModel):
    api_key: str
    voice_id: str = "21m00Tcm4TlvDq8ikWAM"
    model_id: str = "eleven_multilingual_v2"


@router.get("/settings/elevenlabs")
async def get_elevenlabs_settings(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(authorization)
    s = get_settings()

    key = s.elevenlabs_api_key
    masked_key = ""
    if key:
        masked_key = f"...{key[-8:]}" if len(key) > 8 else "XXXXXXXX"

    return {
        "api_key": masked_key,
        "voice_id": s.elevenlabs_voice_id,
        "model_id": s.elevenlabs_model_id,
    }


@router.post("/settings/elevenlabs")
async def save_elevenlabs_settings(
    request: Request,
    body: ElevenLabsBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_admin(authorization)

    # Update live settings singleton
    s = get_settings()
    # If the user passed a masked key, don't overwrite with it
    if not body.api_key.startswith("..."):
        s.elevenlabs_api_key = body.api_key
    s.elevenlabs_voice_id = body.voice_id
    s.elevenlabs_model_id = body.model_id

    # Persist to admin_config
    try:
        store = request.app.state.memory_manager._store
        config = await store.get_admin_config()
        config["elevenlabs_config"] = body.model_dump()
        await store.set_admin_config(config)
    except Exception as e:
        logger.warning("Failed to persist ElevenLabs settings to DB: %s", e)

    logger.info("ElevenLabs settings saved by admin %s.", user_id)
    return {"ok": True}


class PersonaBody(BaseModel):
    system_prompt: str


class WakeWordBody(BaseModel):
    enabled: bool
    phrase: str
    sensitivity: float


@router.get("/settings/wake-word")
async def get_wake_word_settings(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(authorization)
    s = get_settings()

    # Check if openWakeWord is installed
    try:
        import openwakeword  # noqa: F401
        installed = True
    except ImportError:
        installed = False

    return {
        "enabled": s.wake_word_enabled,
        "phrase": s.wake_word_model,
        "sensitivity": s.wake_word_threshold,
        "installed": installed,
    }


@router.post("/settings/wake-word")
async def save_wake_word_settings(
    request: Request,
    body: WakeWordBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_admin(authorization)

    # Update live settings singleton
    s = get_settings()
    s.wake_word_enabled = body.enabled
    s.wake_word_model = body.phrase
    s.wake_word_threshold = body.sensitivity

    # Persist to admin_config
    try:
        store = request.app.state.memory_manager._store
        config = await store.get_admin_config()
        config["wake_word_config"] = body.model_dump()
        await store.set_admin_config(config)
    except Exception as e:
        logger.warning("Failed to persist Wake Word settings to DB: %s", e)

    logger.info("Wake Word settings saved by admin %s.", user_id)
    return {"ok": True}


@router.get("/settings/persona")
async def get_persona(
    request: Request,
    authorization: Optional[str] = Header(default=None)
):
    await _require_admin(authorization)
    return {"system_prompt": get_settings().river_song_system_prompt}


@router.get("/settings/persona/default")
async def get_persona_default(
    request: Request,
    authorization: Optional[str] = Header(default=None)
):
    await _require_admin(authorization)
    # Extract the default value from the Pydantic Field
    from config.settings import Settings
    default_prompt = Settings.model_fields['river_song_system_prompt'].default
    return {"system_prompt": default_prompt}


@router.post("/settings/persona")
async def save_persona(
    request: Request,
    body: PersonaBody,
    authorization: Optional[str] = Header(default=None)
):
    user_id = await _require_admin(authorization)

    # Update live settings
    s = get_settings()
    s.river_song_system_prompt = body.system_prompt

    # Persist to admin_config
    try:
        store = request.app.state.memory_manager._store
        config = await store.get_admin_config()
        config["persona_config"] = {"system_prompt": body.system_prompt}
        await store.set_admin_config(config)
    except Exception as e:
        logger.warning("Failed to persist Persona settings to DB: %s", e)

    logger.info("Persona settings updated by admin %s.", user_id)
    return {"ok": True}


# =============================================================================
# Provider Rate Tracking
# =============================================================================

@router.get("/settings/provider-rate")
def get_current_provider_rate(
    provider: str,
    window: int = 60,
    authorization: Optional[str] = Header(default=None)
):
    # Synchronous because get_provider_rate uses sqlite3 synchronously
    from core.token_tracker import get_provider_rate
    # No auth check needed or just quick check
    if authorization and authorization.startswith("Bearer "):
        pass  # we could require_user but sync auth is tricky, let's keep it open or do async def + run_in_executor

    rate = get_provider_rate(provider, window_seconds=window)
    return {
        "provider": provider,
        "rpm": rate["calls"],
        "window": window
    }


# =============================================================================
# Briefing Settings
# =============================================================================

@router.get("/settings/briefing")
async def get_briefing_settings(
    request: Request,
    authorization: Optional[str] = Header(default=None)
):
    await _require_user(authorization)
    store = request.app.state.memory_manager._store
    config = await store.get_admin_config()
    settings = get_settings()

    return {
        "startup_briefing_enabled": config.get("startup_briefing_enabled", settings.startup_briefing_enabled),
        "pulse_news_enabled": config.get("pulse_news_enabled", True),
        "pulse_news_categories": config.get("pulse_news_categories", ["world", "us"]),
        "pulse_markets_enabled": config.get("pulse_markets_enabled", True),
        "pulse_flights_enabled": config.get("pulse_flights_enabled", True),
        "location_lat": config.get("location_lat", settings.location_lat),
        "location_lon": config.get("location_lon", settings.location_lon),
    }


class BriefingSettingsBody(BaseModel):
    startup_briefing_enabled: bool
    pulse_news_enabled: bool = True
    pulse_news_categories: List[str] = ["world", "us"]
    pulse_markets_enabled: bool = True
    pulse_flights_enabled: bool = True
    location_lat: Optional[float] = None
    location_lon: Optional[float] = None


@router.post("/settings/briefing")
async def save_briefing_settings(
    body: BriefingSettingsBody,
    request: Request,
    authorization: Optional[str] = Header(default=None)
):
    user_id = await _require_admin(authorization)

    store = request.app.state.memory_manager._store
    config = await store.get_admin_config()
    config["startup_briefing_enabled"] = body.startup_briefing_enabled
    config["pulse_news_enabled"] = body.pulse_news_enabled
    config["pulse_news_categories"] = body.pulse_news_categories or ["world", "us"]
    config["pulse_markets_enabled"] = body.pulse_markets_enabled
    config["pulse_flights_enabled"] = body.pulse_flights_enabled
    config["location_lat"] = body.location_lat
    config["location_lon"] = body.location_lon
    await store.set_admin_config(config)

    logger.info("Briefing settings updated by admin %s.", user_id)
    return {"ok": True}
