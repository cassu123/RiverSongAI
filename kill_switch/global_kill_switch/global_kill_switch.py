import sys

global_kill_switch = False
password = "YourPassword123"  # Placeholder for actual secure password storage

def activate_global_kill_switch():
    global global_kill_switch
    global_kill_switch = True
    with open('kill_switch_state.txt', 'w') as f:
        f.write('GLOBAL KILL ACTIVATED\n')
    print("Global kill switch activated! Shutting down...")
    sys.exit()

def reset_global_kill_switch(input_password):
    if input_password == password:
        global global_kill_switch
        global_kill_switch = False
        with open('kill_switch_state.txt', 'w') as f:
            f.write('GLOBAL KILL RESET\n')
        print("Global kill switch reset. System restarting...")
    else:
        print("Incorrect password. Cannot reset the system.")
