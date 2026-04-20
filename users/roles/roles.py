# =============================================================================
# users/roles/roles.py
#
# File Purpose:
#   Defines the user roles available in the River Song AI system.
# =============================================================================

from enum import Enum


class Role(str, Enum):
    ADMIN = "admin"
    USER = "user"
    GUEST = "guest"