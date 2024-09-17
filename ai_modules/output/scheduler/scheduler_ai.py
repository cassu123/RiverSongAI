import schedule
import time

class SchedulerAI:
    def __init__(self):
        self.jobs = []

    def schedule_task(self, task, task_time, repeat=False):
        """Schedules a task at a specific time. Optionally, repeat the task."""
        if repeat:
            job = schedule.every().day.at(task_time).do(task)
        else:
            job = schedule.every().day.at(task_time).do(task)
        
        self.jobs.append(job)
        print(f"Task scheduled for {task_time}")

    def run_scheduled_tasks(self):
        """Runs the scheduled tasks based on their schedule."""
        while True:
            schedule.run_pending()
            time.sleep(1)

    def list_scheduled_tasks(self):
        """Lists all the scheduled tasks."""
        return self.jobs

    def cancel_all_tasks(self):
        """Cancels all scheduled tasks."""
        schedule.clear()
        self.jobs.clear()
        print("All tasks have been cancelled.")
