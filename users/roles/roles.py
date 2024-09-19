# roles.py

class Role:
    ADMIN = "Admin"
    PARENT = "Parent"
    USER = "User"
    CHILD = "Child"

# Permissions for each role
role_permissions = {
    Role.ADMIN: ["view_all", "edit_all", "manage_roles"],
    Role.PARENT: ["view_child", "edit_child", "track_location"],
    Role.USER: ["view_own_profile", "edit_own_profile"],
    Role.CHILD: ["view_limited_profile", "restricted_content"]
}
