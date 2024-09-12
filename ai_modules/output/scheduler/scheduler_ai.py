import logging
import schedule
import threading
import time
import pytz
from datetime import datetime
from typing import Callable, Optional


class Scheduler:
    """
    A class for scheduling tasks to run at specific intervals or times, supporting both one-time and recurring tasks.
    """

    def __init__(self, timezone: str = 'UTC'):
        """
        Initialize the Scheduler class with an empty task list and a specified timezone.

        Args:
            timezone (str): The timezone in which tasks should be scheduled.
        """
        self.tasks = []
        self.timezone = pytz.timezone(timezone)
        self.logger = logging.getLogger(__name__)
        logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    def add_task(self, task_name: str, function: Callable[..., None], interval: int, unit: str = 'seconds', run_once: bool = False) -> None:
        """
        Add a task to the scheduler.

        Args:
            task_name (str): The name of the task.
            function (Callable[..., None]): The function to run.
            interval (int): The interval at which to run the task.
            unit (str, optional): The unit of time for the interval. Defaults to 'seconds'.
            run_once (bool, optional): Whether to run the task once. Defaults to False.
        """
        task = {
            'task_name': task_name,
            'function': function,
            'interval': interval,
            'unit': unit,
            'run_once': run_once
        }
        self.tasks.append(task)
        self.logger.info(f"Task '{task_name}' added to the scheduler.")

    def remove_task(self, task_name: str) -> None:
        """
        Remove a task from the scheduler.

        Args:
            task_name (str): The name of the task to remove.
        """
        self.tasks = [task for task in self.tasks if task['task_name'] != task_name]
        self.logger.info(f"Task '{task_name}' removed from the scheduler.")

    def _run_tasks(self) -> None:
        """
        Run all tasks in the scheduler.
        """
        for task in self.tasks:
            if task['run_once']:
                task['function']()
                self.remove_task(task['task_name'])
            else:
                if task['unit'] == 'seconds':
                    schedule.every(task['interval']).seconds.do(task['function'])
                elif task['unit'] == 'minutes':
                    schedule.every(task['interval']).minutes.do(task['function'])
                elif task['unit'] == 'hours':
                    schedule.every(task['interval']).hours.do(task['function'])
                elif task['unit'] == 'days':
                    schedule.every(task['interval']).days.do(task['function'])
                self.logger.info(f"Task '{task['task_name']}' scheduled to run every {task['interval']} {task['unit']}")

    def run(self) -> None:
        """
        Run the scheduler, executing tasks at their scheduled intervals.
        """
        self.logger.info("Scheduler started.")
        self._run_tasks()
        try:
            while True:
                schedule.run_pending()
                time.sleep(1)
        except Exception as e:
            self.logger.error(f"Error running scheduler: {e}")

    def start_in_thread(self) -> None:
        """
        Start the scheduler in a separate thread.
        """
        scheduler_thread = threading.Thread(target=self.run)
        scheduler_thread.daemon = True
        scheduler_thread.start()
        self.logger.info("Scheduler started in a separate thread.")

if __name__ == "__main__":
    # Example usage
    def example_task():
        print("Executing example task.")

    scheduler = Scheduler(timezone='UTC')

    # Schedule a recurring task every 10 seconds
    scheduler.add_task('example_task', example_task, interval=10, unit='seconds', run_once=False)

    # Start the scheduler in a separate thread
    scheduler.start_in_thread()

    # Keep the main program running
    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        scheduler.logger.info("Scheduler stopped.")
