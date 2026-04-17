"""
File: users/roles/permission.py
Purpose: Provides functions for checking role-based access permissions.
Author: River Song Project
"""

from typing import Protocol
from users.roles.roles import Role, get_role_permissions

class HasRole(Protocol):
    """
    Protocol defining the required interface for a user object
    when checking permissions.
    """
    role: Role

def check_permission(user: HasRole, action: str) -> bool:
    """
    Check if a user has the permission to perform a specific action based on their role.

    Args:
        user (HasRole): The user object to check. Must have a 'role' attribute of type Role.
        action (str): The action or permission key to check for.

    Returns:
        bool: True if the user has the permission, False otherwise.

    Raises:
        ValueError: If the user object lacks a 'role' attribute.
        TypeError: If the user's role is not a valid Role enum instance.
    """
    if not hasattr(user, 'role'):
        raise ValueError("User object must have a 'role' attribute.")

    user_role = user.role

    if not isinstance(user_role, Role):
        raise TypeError(f"Expected user.role to be a Role enum, received {type(user_role).__name__}")

    permissions = get_role_permissions(user_role)
    return action in permissions
