# guest_access.py

def guest_access(user):
    print(f"Welcome {user.username}, you are logged in as a Guest.")
    print("1. View Public Information")

    choice = input("Choose an option: ")
    if choice == "1":
        print("Displaying public information...")
        # Simulate viewing public info
    else:
        print("Invalid option.")
