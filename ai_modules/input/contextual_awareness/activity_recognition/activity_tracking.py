import time

class ActivityTracker:
    def __init__(self):
        self.activities = []

    def log_activity(self, activity_name):
        """
        Logs an activity with a timestamp.
        """
        timestamp = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())
        activity = {'activity': activity_name, 'timestamp': timestamp}
        self.activities.append(activity)
        print(f"Activity Logged: {activity}")

    def get_recent_activities(self, n=5):
        """
        Returns the most recent 'n' activities.
        """
        return self.activities[-n:]

    def clear_activities(self):
        """
        Clears the activity log.
        """
        self.activities = []
        print("Activity log cleared.")

if __name__ == "__main__":
    tracker = ActivityTracker()
    tracker.log_activity('Walking')
    tracker.log_activity('Watching TV')
    print(f"Recent Activities: {tracker.get_recent_activities()}")
