# child_dashboard.py

def child_dashboard(user):
    print(f"Welcome {user.username}, you are logged in as a Child.")
    print("1. View Child-Friendly Content")
    print("2. Access Limited Features")

    choice = input("Choose an option: ")
    if choice == "1":
        print("Displaying child-friendly content...")
        # Simulate displaying child content
    elif choice == "2":
        print("Accessing limited features...")
        # Simulate limited access
    else:
        print("Invalid option.")
