"""
core/csrf.py

CSRF protection for the cookie session, using the double-submit pattern.

**Why this exists.** `require_role` accepts `access_token` from a cookie as
well as from an `Authorization` header, on every route that uses it. A cookie
is attached by the browser automatically, on any request to this origin,
including one initiated by a page the user did not open on purpose. A Bearer
header is not — script on another origin cannot read the token to attach it.
So the moment the cookie became a live auth path, every state-changing route
behind it became forgeable, and `SameSite=lax` is the only thing standing in
the way.

`SameSite=lax` is a good defence and it is not a complete one. It is enforced
by the browser, so it is worth exactly as much as the browser the request came
from — and this server is also spoken to by a Capacitor webview and by native
HTTP clients, where the cookie jar's same-site behaviour is the platform's
business, not ours. Lax also permits top-level cross-site *GET*, which is only
safe while no GET changes state. That is true today; it is one careless route
away from not being true.

**The pattern.** On login the server sets two cookies:

  - `access_token` — httpOnly. Script can never read it.
  - `csrf_token`   — deliberately *not* httpOnly, so the app's own script can
                     read it and echo it back in the `X-CSRF-Token` header.

An unsafe request authenticated by cookie must present both, and they must
match. An attacker on another origin can cause the cookies to be *sent* but
cannot *read* either one — the same-origin policy stops `document.cookie` and
stops reading the response — so the header cannot be forged.

**What is deliberately not enforced.**

- Safe methods (GET/HEAD/OPTIONS/TRACE). If a GET ever changes state, that is
  the bug, and it should be fixed at the route rather than papered over here.
- Requests carrying `Authorization: Bearer`. Those are not CSRF-able in the
  first place: the header has to be set explicitly, and cross-origin script
  has no way to obtain the token. This is what makes the layer safe to switch
  on ahead of the frontend migration — today's header-authenticated frontend
  passes straight through, and the cookie path is protected from the start.
- Requests with no `access_token` cookie. Nothing to ride on.
- The login endpoints, which mint the session rather than consume it. They
  authenticate with a password or a challenge token, neither of which the
  browser supplies on its own.

The token is not bound to the session and does not need to be. Double-submit
rests on the attacker's inability to read the cookie, not on the value being
unguessable to the legitimate holder.
"""

from __future__ import annotations

import hmac
import logging
import secrets
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "x-csrf-token"
SESSION_COOKIE_NAME = "access_token"

#: Methods that cannot change state, and so are not checked.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

#: Paths that establish a session rather than acting on one. They are reached
#: before a CSRF cookie can exist, and they carry their own proof (a password,
#: a TOTP challenge, an OAuth code), so a forged call to them gains nothing an
#: attacker did not already have.
EXEMPT_PATHS = frozenset(
    {
        "/api/auth/setup",
        "/api/auth/signup",
        "/api/auth/login",
        "/api/auth/login/totp",
        "/api/auth/google/callback",
    }
)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def tokens_match(cookie_value: Optional[str], header_value: Optional[str]) -> bool:
    """Constant-time comparison that treats either side missing as a failure."""
    if not cookie_value or not header_value:
        return False
    return hmac.compare_digest(cookie_value, header_value)


def csrf_required(
    method: str,
    path: str,
    cookies: dict,
    headers: dict,
    exempt_paths: Iterable[str] = EXEMPT_PATHS,
) -> bool:
    """Whether this request must present a matching CSRF token.

    Split out from the middleware so the policy can be tested directly,
    without a transport underneath it.
    """
    if method.upper() in SAFE_METHODS:
        return False
    if path in exempt_paths:
        return False
    if SESSION_COOKIE_NAME not in cookies:
        return False
    authorization = headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        # Header auth. Cross-origin script cannot set this, so there is no
        # CSRF to protect against — and the cookie riding along is incidental.
        return False
    return True


def set_csrf_cookie(response, *, secure: bool, max_age: int) -> str:
    """Issue a fresh CSRF token alongside the session cookie.

    Not httpOnly, on purpose: the app's own script has to read this one to
    echo it back. That is the whole mechanism, and it gives an attacker
    nothing — reading it still requires being on this origin, and anything
    already running on this origin can forge requests regardless.
    """
    token = new_csrf_token()
    response.set_cookie(
        CSRF_COOKIE_NAME,
        token,
        httponly=False,
        secure=secure,
        samesite="lax",
        max_age=max_age,
        path="/",
    )
    return token


def clear_csrf_cookie(response) -> None:
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")


class CSRFMiddleware:
    """Pure-ASGI double-submit check.

    ASGI rather than `BaseHTTPMiddleware` for the same reason the Cloudflare
    IP middleware is: `BaseHTTPMiddleware` buffers request and response
    bodies, which this codebase streams (SSE, audio, WebSocket upgrades).

    The request body is never read here. Only the scope's method, path,
    headers and cookies are inspected, so a rejected request is refused
    before its body is touched.
    """

    def __init__(self, app, *, enabled: bool = True):
        self.app = app
        self.enabled = enabled

    async def __call__(self, scope, receive, send):
        if not self.enabled or scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        from starlette.requests import Request

        request = Request(scope)
        if not csrf_required(
            request.method, request.url.path, request.cookies, request.headers
        ):
            await self.app(scope, receive, send)
            return

        cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
        header_token = request.headers.get(CSRF_HEADER_NAME)
        if tokens_match(cookie_token, header_token):
            await self.app(scope, receive, send)
            return

        logger.warning(
            "CSRF check failed on %s %s (cookie=%s, header=%s)",
            request.method,
            request.url.path,
            "present" if cookie_token else "missing",
            "present" if header_token else "missing",
        )

        from starlette.responses import JSONResponse

        response = JSONResponse(
            status_code=403,
            content={
                "detail": (
                    "CSRF token missing or invalid. Send the value of the "
                    "csrf_token cookie in the X-CSRF-Token header, or "
                    "authenticate with an Authorization: Bearer header."
                )
            },
        )
        await response(scope, receive, send)
