import ast

with open('api/routes/culinary.py', 'r') as f:
    code = f.read()

tree = ast.parse(code)
functions = []
for node in tree.body:
    if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
        is_route = any(
            isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.value.id == 'router'
            for d in node.decorator_list if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and isinstance(d.func.value, ast.Name)
        )
        functions.append((node.name, is_route))

print("Total functions:", len(functions))
routes = [f[0] for f in functions if f[1]]
helpers = [f[0] for f in functions if not f[1]]
print("Routes:", len(routes), routes)
print("Helpers:", len(helpers), helpers)
