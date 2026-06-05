import re

with open("api/routes/models_settings.py", "r") as f:
    content = f.read()

# Fix dict.get issue
content = content.replace(
    '        "provider_label":  provider_labels.get(active_engine, active_engine),',
    '        "provider_label":  provider_labels.get(str(active_engine), str(active_engine)),'
)

# Fix removeprefix on None
content = content.replace(
    '    payload = await decode_token(authorization.removeprefix("Bearer "))',
    '    payload = await decode_token(authorization.removeprefix("Bearer ")) if authorization else {}'
)
# And `decode_token` is sync
content = content.replace(
    '    payload = await decode_token(authorization.removeprefix("Bearer ")) if authorization else {}',
    '    payload = decode_token(authorization.removeprefix("Bearer ")) if authorization else {}'
)
# And payload might be None
content = content.replace(
    '    if payload.get("role") != "admin":',
    '    if not payload or payload.get("role") != "admin":'
)

with open("api/routes/models_settings.py", "w") as f:
    f.write(content)
