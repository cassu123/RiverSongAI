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

def find_frontend_api_calls():
    api_calls = []
    # simple heuristic: look for strings starting with /api/ or backticks with /api/
    # also we can just grep the whole src for endpoint paths
    return api_calls

def main():
    endpoints = find_backend_endpoints()
    
    # load all frontend files content into memory
    frontend_text = ""
    for root, _, files in os.walk("frontend/src"):
        for file in files:
            if file.endswith((".js", ".jsx", ".ts", ".tsx")):
                with open(os.path.join(root, file), "r") as f:
                    frontend_text += f.read() + "\n"
    
    missing_in_frontend = []
    for method, path, filename in endpoints:
        # replace path params {param} with regex or just check the base path
        base_path = re.sub(r'\{[^}]+\}', '', path).rstrip('/')
        if not base_path:
            continue
            
        if base_path not in frontend_text:
            missing_in_frontend.append((method, path, filename))
            
    print(f"Total backend endpoints: {len(endpoints)}")
    print(f"Endpoints not explicitly found in frontend code: {len(missing_in_frontend)}")
    for method, path, filename in sorted(missing_in_frontend, key=lambda x: x[2]):
        print(f"[{filename}] {method} {path}")

if __name__ == "__main__":
    main()
