"""
File: users/roles/roles.py
Purpose: Defines the system roles and their associated default permissions.
Author: River Song Project
"""

from enum import Enum

class Role(str, Enum):
    """
    Enumeration representing the valid roles within the system.
    """
    ADMIN = "Admin"
    PARENT = "Parent"
    USER = "User"
    CHILD = "Child"
    GUEST = "Guest"

# Define the baseline permissions for each role to ensure consistency across the application.
ROLE_PERMISSIONS: dict[Role, set[str]] = {
    Role.ADMIN: {"view_all", "edit_all", "manage_roles", "manage_users", "track_location", "system_config"},
    Role.PARENT: {"view_child", "edit_child", "track_location", "manage_family", "view_own_profile", "edit_own_profile"},
    Role.USER: {"view_own_profile", "edit_own_profile", "basic_access"},
    Role.CHILD: {"view_limited_profile", "restricted_content", "play_games"},
    Role.GUEST: {"view_guest_profile", "basic_access"}
}

def get_role_permissions(role: Role) -> set[str]:
    """
    Retrieve the set of permissions associated with a specific role.

    Args:
        role (Role): The role to query permissions for.

    Returns:
        set[str]: A set of permission strings for the specified role.
        
    Raises:
        TypeError: If the provided role is not a valid Role enum instance.
    """
    if not isinstance(role, Role):
        raise TypeError(f"Expected a Role enum, received {type(role).__name__}")
    return ROLE_PERMISSIONS.get(role, set())
