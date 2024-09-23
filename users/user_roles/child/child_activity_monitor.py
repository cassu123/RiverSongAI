# /user_roles/child/child_activity_monitor.py

def simulate_texts():
    # Simulated text messages
    text_log = [
        {"from": "123-456-7890", "message": "Hey, how are you?", "timestamp": "10:30 AM"},
        {"from": "friend_123", "message": "Let's play after school.", "timestamp": "12:15 PM"},
        {"to": "mom", "message": "I'll be home soon.", "timestamp": "2:45 PM"}
    ]
    return text_log

def simulate_calls():
    # Simulated call log
    call_log = [
        {"from": "123-456-7890", "duration": "5 min", "timestamp": "10:00 AM"},
        {"from": "123-111-2222", "duration": "2 min", "timestamp": "11:45 AM"},
        {"to": "mom", "duration": "3 min", "timestamp": "3:00 PM"}
    ]
    return call_log

def monitor_child_activity():
    text_log = simulate_texts()
    call_log = simulate_calls()

    print("Child's Texts:")
    for text in text_log:
        print(f"{text['timestamp']} - {text.get('from', text.get('to'))}: {text['message']}")

    print("\nChild's Calls:")
    for call in call_log:
        print(f"{call['timestamp']} - {call.get('from', call.get('to'))}: {call['duration']}")

    return {"texts": text_log, "calls": call_log}
