# admin_dashboard.py

# Mocked user object class for demonstration
class User:
    def __init__(self, username, role):
        self.username = username
        self.role = role

# Simulated user profiles
user_profiles = [
    {"username": "parent_user", "role": "Parent", "children": ["Alice", "Bob"]},
    {"username": "child_user_1", "role": "Child", "activity": "Browsing videos"},
    {"username": "guest_user", "role": "Guest", "access_level": "Limited"}
]

# Simulated system settings
system_settings = {
    "default_screen_time": 3,  # Default screen time limit in hours
    "location_tracking_enabled": True,
    "activity_logging_enabled": True
}

# Simulated system logs
system_logs = [
    "User parent_user logged in",
    "User child_user_1 accessed restricted app",
    "User guest_user attempted to bypass screen time limit"
]

# Function to log admin actions
def log_action(action):
    system_logs.append(action)
    print(f"Action logged: {action}")

# View all user profiles
def view_all_user_profiles():
    print("\n-- All User Profiles --")
    for profile in user_profiles:
        print(f"Username: {profile['username']}, Role: {profile['role']}")
        if "children" in profile:
            print(f"Children: {', '.join(profile['children'])}")
        if "activity" in profile:
            print(f"Current Activity: {profile['activity']}")
        print("-" * 30)

# Add a new user profile
def add_user_profile():
    print("\n-- Add New User --")
    username = input("Enter the new user's username: ")
    role = input("Enter the new user's role (Admin, Parent, Child, Guest): ")
    
    if role not in ["Admin", "Parent", "Child", "Guest"]:
        print("Invalid role. Please choose from Admin, Parent, Child, or Guest.")
        return
    
    new_user = {"username": username, "role": role}
    user_profiles.append(new_user)
    log_action(f"Admin added new user {username} with role {role}.")
    print(f"New user {username} added with role {role}.")

# Edit an existing user profile
def edit_user_profile():
    print("\n-- Edit User Profile --")
    view_all_user_profiles()
    
    username = input("Enter the username of the profile to edit: ")
    for profile in user_profiles:
        if profile["username"] == username:
            new_role = input(f"Enter the new role for {username} (Admin, Parent, Child, Guest): ")
            if new_role not in ["Admin", "Parent", "Child", "Guest"]:
                print("Invalid role. Please choose from Admin, Parent, Child, or Guest.")
                return
            profile["role"] = new_role
            log_action(f"Admin updated {username}'s role to {new_role}.")
            print(f"Updated {username}'s role to {new_role}.")
            return
    print(f"User {username} not found.")

# Delete a user profile
def delete_user_profile():
    print("\n-- Delete User Profile --")
    view_all_user_profiles()
    
    username = input("Enter the username of the profile to delete: ")
    global user_profiles
    if any(profile["username"] == username for profile in user_profiles):
        user_profiles = [profile for profile in user_profiles if profile["username"] != username]
        log_action(f"Admin deleted user {username}.")
        print(f"User {username} has been deleted.")
    else:
        print(f"User {username} not found.")

# Simulate device control (reuse from parent panel)
def control_user_devices():
    print("\n-- Control User Devices --")
    view_all_user_profiles()
    
    username = input("Enter the username to control their device: ")
    selected_user = next((user for user in user_profiles if user["username"] == username), None)
    
    if selected_user:
        log_action(f"Admin controlled devices for {username}.")
        print(f"Controlling devices for {username}... (Simulated)")
    else:
        print(f"User {username} not found.")

# Modify system settings
def modify_system_settings():
    print("\n-- Modify System Settings --")
    print(f"1. Default Screen Time: {system_settings['default_screen_time']} hours")
    print(f"2. Location Tracking Enabled: {system_settings['location_tracking_enabled']}")
    print(f"3. Activity Logging Enabled: {system_settings['activity_logging_enabled']}")
    
    choice = input("Select a setting to change (1-3): ")
    
    if choice == "1":
        new_time = int(input("Enter the new default screen time (in hours): "))
        system_settings["default_screen_time"] = new_time
        log_action(f"Admin set default screen time to {new_time} hours.")
        print(f"Default screen time set to {new_time} hours.")
    elif choice == "2":
        status = input("Enable location tracking? (yes/no): ").lower()
        system_settings["location_tracking_enabled"] = status == "yes"
        log_action(f"Admin set location tracking to {status}.")
        print(f"Location tracking set to {status}.")
    elif choice == "3":
        status = input("Enable activity logging? (yes/no): ").lower()
        system_settings["activity_logging_enabled"] = status == "yes"
        log_action(f"Admin set activity logging to {status}.")
        print(f"Activity logging set to {status}.")
    else:
        print("Invalid option.")

# View system logs
def view_system_logs():
    print("\n-- System Logs --")
    for log in system_logs:
        print(log)
    print("-" * 30)

# Admin dashboard with user role validation
def admin_dashboard(user):
    if user.role != "Admin":
        print(f"Access denied. {user.username} is not an Admin.")
        return
    
    print(f"\nWelcome {user.username}, you are logged in as an Admin.")
    
    while True:
        print("\n-- Admin Dashboard --")
        print("1. View All User Profiles")
        print("2. Add New User")
        print("3. Edit User Profile")
        print("4. Delete User Profile")
        print("5. Control User Devices")
        print("6. Modify System-Wide Settings")
        print("7. View System Logs")
        print("8. Exit")
        
        choice = input("Choose an option: ")

        if choice == "1":
            view_all_user_profiles()
        elif choice == "2":
            add_user_profile()
        elif choice == "3":
            edit_user_profile()
        elif choice == "4":
            delete_user_profile()
        elif choice == "5":
            control_user_devices()
        elif choice == "6":
            modify_system_settings()
        elif choice == "7":
            view_system_logs()
        elif choice == "8":
            print("Exiting Admin Dashboard.")
            break
        else:
            print("Invalid option. Please select a valid option from 1 to 8.")

# Example usage
if __name__ == "__main__":
    admin_user = User(username="admin_user", role="Admin")
    admin_dashboard(admin_user)
