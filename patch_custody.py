import re

with open("inventory/models.py", "r") as f:
    content = f.read()

# 1. Deprecate columns in inventory/models.py
content = re.sub(
    r'current_custodian_id = Column\(Integer, nullable=True\)',
    r'current_custodian_id = Column(Integer, nullable=True) # DEPRECATED: Custody features removed per owner decision',
    content
)
content = re.sub(
    r'issued_at = Column\(DateTime, nullable=True\)',
    r'issued_at = Column(DateTime, nullable=True) # DEPRECATED',
    content
)
# AssetStatus.IN_USE removal? Let's check if IN_USE exists.
content = content.replace("'IN_USE'", "'IN_USE' # DEPRECATED")

with open("inventory/models.py", "w") as f:
    f.write(content)

with open("inventory/management.py", "r") as f:
    content = f.read()

# 2. Delete issue_item and return_item from inventory/management.py
content = re.sub(r'def issue_item\(.*?\n(?:    .*\n)*?(?=\n\w)', '\n', content)
content = re.sub(r'def return_item\(.*?\n(?:    .*\n)*?(?=\n\w)', '\n', content)
with open("inventory/management.py", "w") as f:
    f.write(content)

with open("api/routes/inventory.py", "r") as f:
    content = f.read()

# 3. Delete IssueItem schema from api/routes/inventory.py if it exists
content = re.sub(r'class IssueItem\(BaseModel\):\n(?:    .*\n)*?(?=\n\w)', '\n', content)
# 4. Delete POST /items/{id}/issue and POST /items/{id}/return
content = re.sub(r'@router\.post\("/items/\{item_id\}/issue"\)\nasync def issue_item_route\(.*?\n(?:    .*\n)*?(?=\n@|\Z)', '\n', content)
content = re.sub(r'@router\.post\("/items/\{item_id\}/return"\)\nasync def return_item_route\(.*?\n(?:    .*\n)*?(?=\n@|\Z)', '\n', content)

# 5. Remove custody fields from serializers if present (Pydantic models)
content = re.sub(r'    current_custodian_id: Optional\[int\]( = None)?\n', '', content)
content = re.sub(r'    issued_at: Optional\[datetime\]( = None)?\n', '', content)

with open("api/routes/inventory.py", "w") as f:
    f.write(content)

