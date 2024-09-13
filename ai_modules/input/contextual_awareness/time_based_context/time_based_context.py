import time

class TimeBasedContext:
    def __init__(self):
        self.time_data = {}

    def track_activity_by_time(self, activity_name):
        """
        Tracks activities along with the time they occurred.
        """
        current_time = time.strftime('%H:%M:%S', time.localtime())
        self.time_data[activity_name] = current_time
        print(f"Activity '{activity_name}' tracked at {current_time}.")

    def get_activity_time(self, activity_name):
        """
        Retrieves the time an activity was last performed.
        """
        return self.time_data.get(activity_name, "No data available")

if __name__ == "__main__":
    time_context = TimeBasedContext()
    time_context.track_activity_by_time('Breakfast')
    time_context.track_activity_by_time('Reading')
    print(f"Breakfast Time: {time_context.get_activity_time('Breakfast')}")
