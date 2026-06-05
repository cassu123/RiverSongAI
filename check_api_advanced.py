import os
import re
import glob

def find_backend_endpoints():
    endpoints = []
    for filepath in glob.glob("api/routes/*.py"):
        with open(filepath, "r") as f:
            for line in f:
                match = re.search(r'@(?:router|app)\.(get|post|put|delete|patch)\(["\']([^"\']+)["\']', line)
                if match:
                    method = match.group(1).upper()
                    path = match.group(2)
                    endpoints.append((method, path, os.path.basename(filepath)))
    return endpoints

def generate_frontend_patterns(path):
    # Convert /items/{item_id}/receipt to something like:
    # /items/\${.*?}/receipt or similar
    parts = path.strip('/').split('/')
    regex_parts = []
    for p in parts:
        if p.startswith('{') and p.endswith('}'):
            regex_parts.append(r'(?:\$\{[^}]+\}|[^/]+)')
        else:
            regex_parts.append(re.escape(p))
    
    # We allow /api optional prefix
    pattern = r'(?:/api)?/' + r'/'.join(regex_parts) + r'/?(?=["\'`]|\?|\s)'
    return pattern

def main():
    endpoints = find_backend_endpoints()
    
    frontend_text = ""
    for root, _, files in os.walk("frontend/src"):
        for file in files:
            if file.endswith((".js", ".jsx", ".ts", ".tsx")):
                with open(os.path.join(root, file), "r") as f:
                    frontend_text += f.read() + "\n"
    
    missing_in_frontend = []
    for method, path, filename in endpoints:
        pattern = generate_frontend_patterns(path)
        if not re.search(pattern, frontend_text):
            missing_in_frontend.append((method, path, filename))
            
    # Group missing by filename
    by_file = {}
    for method, path, filename in missing_in_frontend:
        if filename not in by_file:
            by_file[filename] = []
        by_file[filename].append(f"{method} {path}")

    for filename, routes in sorted(by_file.items()):
        print(f"\n--- {filename} ({len(routes)} missing) ---")
        for route in routes:
            print(f"  {route}")

    print(f"\nTotal endpoints: {len(endpoints)}")
    print(f"Missing endpoints: {len(missing_in_frontend)}")

if __name__ == "__main__":
    main()
