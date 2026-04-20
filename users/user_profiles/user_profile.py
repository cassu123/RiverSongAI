# =============================================================================
# users/user_profiles/user_profile.py
#
# File Purpose:
#   Defines the UserProfile data model for River Song AI.
# =============================================================================

from dataclasses import dataclass
from typing import Optional

from users.roles.roles import Role


@dataclass
class UserProfile:
    """
    Represents a user's profile in the River Song AI system.
    """
    id: str
    email: str
    role: Role = Role.USER
    # Additional fields can be added here as needed, e.g., display_name, preferences, etc.