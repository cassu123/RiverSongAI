# user_profile.py

class UserProfile:
    def __init__(self, username, role):
        self.username = username
        self.role = role

# Create some users with different roles
admin_user = UserProfile("admin_user", Role.ADMIN)
parent_user = UserProfile("parent_user", Role.PARENT)
child_user = UserProfile("child_user", Role.CHILD)
