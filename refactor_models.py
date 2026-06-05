import re

with open("culinary/models.py", "r") as f:
    lines = f.readlines()

new_lines = []
has_typing = False
for line in lines:
    if "from typing import" in line:
        has_typing = True
        
if not has_typing:
    new_lines.append("from typing import Optional, Any\n")

for line in lines:
    # Handle imports
    if "from sqlalchemy.orm import " in line and "Mapped" not in line:
        line = line.replace("declarative_base, relationship", "declarative_base, relationship, Mapped, mapped_column")
    if "Column," in line and "mapped_column" not in line:
        line = line.replace("Column,", "Column, mapped_column,")
        
    # Handle Column definitions
    match = re.search(r"^(\s*)([a-zA-Z0-9_]+)\s*=\s*Column\(\s*([^,]+)(.*?)\s*\)\s*(#.*)?$", line)
    if match:
        indent = match.group(1)
        name = match.group(2)
        type_args = match.group(3).strip()
        rest = match.group(4)
        comment = match.group(5) or ""
        
        mapped_type = "Any"
        if "String" in type_args or "Text" in type_args:
            mapped_type = "str"
        elif "Boolean" in type_args:
            mapped_type = "bool"
        elif "DateTime" in type_args:
            mapped_type = "datetime"
        elif "Integer" in type_args:
            mapped_type = "int"
        elif "Float" in type_args:
            mapped_type = "float"
        elif "Enum" in type_args:
            m = re.search(r"Enum\(([A-Za-z]+)\)", type_args)
            if m:
                mapped_type = m.group(1)
        
        if "nullable=True" in rest or "nullable=True" in type_args:
            mapped_type = f"Optional[{mapped_type}]"
            
        new_line = f"{indent}{name}: Mapped[{mapped_type}] = mapped_column({type_args}{rest}){comment}\n"
        new_lines.append(new_line)
    else:
        new_lines.append(line)

with open("culinary/models.py", "w") as f:
    f.writelines(new_lines)
