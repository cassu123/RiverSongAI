# user_management.py

class UserManager:
    def __init__(self):
        self.users = []

    def add_user(self, username, role):
        user = UserProfile(username, role)
        self.users.append(user)

    def get_user(self, username):
        for user in self.users:
            if user.username == username:
                return user
        return None

# Example usage
manager = UserManager()
manager.add_user("new_child", Role.CHILD)
child_profile = manager.get_user("new_child")
print(child_profile.username, child_profile.role)
