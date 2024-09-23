# permissions.py

def check_permission(user, action):
    user_role = user.role
    if action in role_permissions.get(user_role, []):
        return True
    else:
        return False

# Example usage
action = "track_location"

if check_permission(parent_user, action):
    print("Permission granted")
else:
    print("Permission denied")


# In permissions.py
from user_profiles import UserProfile
from roles import role_permissions

def check_permission(user, action):
    user_role = user.role
    if action in role_permissions.get(user_role, []):
        return True
    return False
