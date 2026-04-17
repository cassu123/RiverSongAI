"""
File: users/user_profiles/user_profile.py
Purpose: Defines the data model for user profiles within the system.
Author: River Song Project
"""

from typing import Optional
from users.roles.roles import Role

class UserProfile:
    """
    Represents a user profile in the system.
    """

    def __init__(self, username: str, role: Role, user_id: Optional[str] = None):
        """
        Initialize a new UserProfile.

        Args:
            username (str): The display name or identifier for the user.
            role (Role): The designated role for this user, dictating their permissions.
            user_id (Optional[str]): An optional unique identifier for the user. 
                                     Defaults to None.

        Raises:
            ValueError: If the username is empty.
            TypeError: If the role is not a valid Role enum instance.
        """
        if not username or not isinstance(username, str):
            raise ValueError("Username must be a non-empty string.")
        
        if not isinstance(role, Role):
            raise TypeError(f"Expected role to be a Role enum, received {type(role).__name__}")

        self.username: str = username
        self.role: Role = role
        self.user_id: Optional[str] = user_id

    def __repr__(self) -> str:
        """
        Return a string representation of the UserProfile.

        Returns:
            str: A formatted string containing the username and role.
        """
        return f"<UserProfile(username='{self.username}', role='{self.role.value}')>"
