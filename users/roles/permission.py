"""
users/roles/permission.py
Purpose: Defines the permissions associated with each user role.
Author: River Song Project
"""

from typing import Dict, List
from .roles import Role

class Permission:
    """
    Available permission keys in the system.
    """
    SYSTEM_ADMIN = "SYSTEM_ADMIN"
    MANAGE_USERS = "MANAGE_USERS"
    MANAGE_CHILDREN = "MANAGE_CHILDREN"
    VIEW_DASHBOARD = "VIEW_DASHBOARD"
    BASIC_ACCESS = "BASIC_ACCESS"
    GUEST_ACCESS = "GUEST_ACCESS"

ROLE_PERMISSIONS: Dict[Role, List[str]] = {
    Role.ADMIN: [
        Permission.SYSTEM_ADMIN,
        Permission.MANAGE_USERS,
        Permission.MANAGE_CHILDREN,
        Permission.VIEW_DASHBOARD,
        Permission.BASIC_ACCESS
    ],
    Role.PARENT: [
        Permission.MANAGE_CHILDREN,
        Permission.VIEW_DASHBOARD,
        Permission.BASIC_ACCESS
    ],
    Role.USER: [
        Permission.VIEW_DASHBOARD,
        Permission.BASIC_ACCESS
    ],
    Role.CHILD: [
        Permission.BASIC_ACCESS
    ],
    Role.GUEST: [
        Permission.GUEST_ACCESS
    ]
}

def get_permissions_for_role(role: Role) -> List[str]:
    """
    Retrieve the list of permissions associated with a given role.
    
    Args:
        role (Role): The role to get permissions for.
        
    Returns:
        List[str]: A list of permission strings.
    """
    return ROLE_PERMISSIONS.get(role, [])
