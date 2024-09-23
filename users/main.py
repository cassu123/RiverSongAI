# main.py
from user_profiles import UserProfile
from roles import Role
from user_roles.admin.admin_dashboard import admin_dashboard
from user_roles.parent.parent_control_panel import parent_control_panel
from user_roles.child.child_dashboard import child_dashboard
from user_roles.guest.guest_access import guest_access

# Simulate user login
def login(username, role):
    return UserProfile(username, role)

# Route to the respective dashboard based on the user role
def launch_dashboard(user):
    if user.role == Role.ADMIN:
        admin_dashboard(user)
    elif user.role == Role.PARENT:
        parent_control_panel(user)
    elif user.role == Role.CHILD:
        child_dashboard(user)
    elif user.role == Role.GUEST:
        guest_access(user)
    else:
        print("Invalid role!")

# Example of login and dashboard launch
if __name__ == "__main__":
    # You can change this to test different roles
    logged_in_user = login("parent_user", Role.PARENT)
    launch_dashboard(logged_in_user)
