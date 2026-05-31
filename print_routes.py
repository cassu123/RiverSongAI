from main import create_app
app = create_app()
for route in app.routes:
    if hasattr(route, "path") and "/api/vector/config" in route.path:
        print(route.path, route.methods)
