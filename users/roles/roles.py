"""
users/roles/roles.py
Purpose: Defines the available user roles within the River Song system.
Author: River Song Project
"""

from enum import Enum

class Role(str, Enum):
    """
    Enumeration of all supported user roles in the system.
    """
    ADMIN = "ADMIN"
    PARENT = "PARENT"
    USER = "USER"
    CHILD = "CHILD"
    GUEST = "GUEST"
