import re

def fix_auth_py():
    with open('api/routes/auth.py', 'r') as f:
        content = f.read()

    # Add Response to imports
    if 'from fastapi import ' in content and 'Response' not in content:
        content = re.sub(r'from fastapi import ([^\n]+)', r'from fastapi import Response, \1', content, count=1)

    # Add helper function
    helper = """
def _extract_token(request: Request, authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.startswith("Bearer "):
        return authorization.removeprefix("Bearer ").strip()
    return request.cookies.get("access_token")

async def _get_auth_payload(request: Request, authorization: Optional[str]) -> dict:
    token = _extract_token(request, authorization)
    if not token:
        raise unauthorized("Not authenticated.")
    payload = await decode_token(token)
    if not payload:
        raise unauthorized("Invalid or expired token.")
    return payload
"""
    if '_extract_token' not in content:
        content = content.replace("class SignupBody(BaseModel):", helper + "\nclass SignupBody(BaseModel):")

    # Fix endpoints to use _get_auth_payload
    replacements = [
        (
            r'if not authorization or not authorization\.startswith\("Bearer "\):\s*raise unauthorized\("Not authenticated\."\)\s*payload = await decode_token\(authorization\.removeprefix\("Bearer "\)\)\s*if not payload:\s*raise unauthorized\("Invalid or expired token\."\)',
            r'payload = await _get_auth_payload(request, authorization)'
        ),
        (
            r'if not authorization or not authorization\.startswith\("Bearer "\):\s*raise unauthorized\("Not authenticated\."\)\s*token = authorization\.removeprefix\("Bearer "\)\s*payload = await decode_token\(token\)\s*if not payload:\s*raise unauthorized\("Invalid or expired token\."\)',
            r'payload = await _get_auth_payload(request, authorization)'
        )
    ]
    for old, new in replacements:
        content = re.sub(old, new, content)

    # Fix me endpoint which is slightly different
    content = re.sub(
        r'@router\.get\("/me"\)\s*async def me\(request: Request,\s*authorization: Optional\[str\] = Header\(default=None\)\):\s*if not authorization or not authorization\.startswith\("Bearer "\):\s*raise unauthorized\("Not authenticated\."\)\s*token = authorization\.removeprefix\("Bearer "\)\s*payload = await decode_token\(token\)\s*if not payload:\s*raise unauthorized\("Invalid or expired token\."\)',
        r'@router.get("/me")\nasync def me(request: Request, authorization: Optional[str] = Header(default=None)):\n    payload = await _get_auth_payload(request, authorization)',
        content
    )

    # Fix logout
    logout_old = """@router.post("/logout", status_code=204)
async def logout(request: Request,
                 authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        return  # Ignore if not logged in

    token = authorization.removeprefix("Bearer ").strip()
    payload = await decode_token(token)"""
    logout_new = """@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response,
                 authorization: Optional[str] = Header(default=None)):
    response.delete_cookie("access_token")
    token = _extract_token(request, authorization)
    if not token:
        return
    payload = await decode_token(token)"""
    content = content.replace(logout_old, logout_new)

    # Fix _require_admin
    admin_old = """async def _require_admin(request: Request,
                         authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")"""
    admin_new = """async def _require_admin(request: Request,
                         authorization: Optional[str]) -> dict:
    payload = await _get_auth_payload(request, authorization)"""
    content = content.replace(admin_old, admin_new)

    # Fix setup
    content = content.replace('async def setup(request: Request, body: SetupBody):', 'async def setup(request: Request, response: Response, body: SetupBody):')
    content = re.sub(
        r'token = create_access_token\((.*?)\)\n(.*?)return \{"token": token,',
        r'token = create_access_token(\1)\n\2response.set_cookie("access_token", token, httponly=True, secure=get_settings().environment == "production", samesite="lax", max_age=get_settings().jwt_expire_minutes * 60)\n    return {"token": token,',
        content, flags=re.DOTALL
    )

    with open('api/routes/auth.py', 'w') as f:
        f.write(content)

def fix_core_auth():
    with open('core/auth.py', 'r') as f:
        content = f.read()
    
    old = """            if auth and auth.startswith("Bearer "):
                token = auth.split(" ")[1]
                user = await decode_token(token)
                if user:
                    request.state.user = user"""
    
    new = """            token = None
            if auth and auth.startswith("Bearer "):
                token = auth.split(" ")[1]
            if not token:
                token = request.cookies.get("access_token")
            if token:
                user = await decode_token(token)
                if user:
                    request.state.user = user"""
    content = content.replace(old, new)
    
    with open('core/auth.py', 'w') as f:
        f.write(content)

fix_auth_py()
fix_core_auth()
print("Auth backend migrated.")
