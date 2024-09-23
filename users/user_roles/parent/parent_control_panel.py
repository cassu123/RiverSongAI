# parent_control_panel.py

# Simulated list of child profiles
children = [
    {"name": "Alice", "age": 13, "device_id": "device_alice"},
    {"name": "Bob", "age": 10, "device_id": "device_bob"}
]

# Parent control panel for monitoring child activity and location
def parent_control_panel(user):
    selected_children = []
    print(f"\nWelcome {user.username}, you are logged in as a Parent.")
    
    while True:
        print("\n-- Parent Control Panel --")
        print("1. Select Child Profiles")
        print("2. Set Restrictions")
        print("3. Track Child Location")
        print("4. View Child Activity (Texts, Calls)")
        print("5. Control Child Devices")
        print("6. Exit")
        
        choice = input("Choose an option: ")

        if choice == "1":
            selected_children = select_child_profiles()
        elif choice == "2":
            set_child_restrictions(selected_children)
        elif choice == "3":
            track_child_location(selected_children)
        elif choice == "4":
            view_child_activity(selected_children)
        elif choice == "5":
            control_child_devices(selected_children)
        elif choice == "6":
            print("Exiting Parent Control Panel.")
            break
        else:
            print("Invalid option. Please select a valid option from 1 to 6.")

# Function to allow parents to select one or multiple child profiles
def select_child_profiles():
    print("\n-- Select Child Profiles --")
    selected_children = []
    for i, child in enumerate(children, 1):
        print(f"{i}. {child['name']} (age {child['age']})")
    
    choices = input("Enter the numbers of the children to select (comma-separated): ")
    
    selected_indices = [int(x.strip()) - 1 for x in choices.split(",") if x.isdigit() and 1 <= int(x.strip()) <= len(children)]
    
    selected_children = [children[i] for i in selected_indices]
    
    print(f"Selected children: {[child['name'] for child in selected_children]}")
    return selected_children


# parent_control_panel.py

from user_roles.child.child_device_control import lock_device, restrict_apps, set_screen_time_limit

# Function to control various aspects of the child’s devices
def control_child_devices(selected_children):
    if not selected_children:
        print("No child profiles selected. Please select one or more profiles first.")
        return
    
    print("\n-- Control Child Devices --")
    for child in selected_children:
        print(f"Controlling device of {child['name']}.")

        print("1. Lock Device")
        print("2. Restrict Apps")
        print("3. Set Screen Time Limit")
        print("4. Go Back")

        choice = input("Choose an option: ")
        if choice == "1":
            lock_device(child['device_id'])
        elif choice == "2":
            apps = input("Enter the names of the apps to restrict (comma-separated): ")
            restrict_apps(child['device_id'], apps.split(","))
        elif choice == "3":
            limit = input("Enter the screen time limit in hours: ")
            set_screen_time_limit(child['device_id'], limit)
        elif choice == "4":
            print("Going back to previous menu.")
            break
        else:
            print("Invalid option. Please select a valid option.")
