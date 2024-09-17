import json
import os
import time
import threading
import logging
from typing import Callable, Dict, Any, List, Optional
from datetime import datetime, timedelta

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class Scheduler:
    """
    A class for scheduling tasks to run at specific intervals or times.
    """

    def __init__(self, data_file: str = 'scheduler_data.json'):
        """
        Initialize the Scheduler class with a task list and a stop event.
        Args:
            data_file (str): The file path to store and load scheduled tasks.
        """
        self.tasks: List[Dict[str, Any]] = []
        self._stop_event = threading.Event()  # Event to stop the scheduler gracefully
        self._lock = threading.Lock()  # Lock for thread safety when modifying tasks
        self.data_file = data_file
        self.load_tasks()
        logging.info("Scheduler initialized.")

    def load_tasks(self) -> None:
        """
        Loads scheduled tasks from a file.
        """
        if os.path.exists(self.data_file):
            with open(self.data_file, 'r') as file:
                self.tasks = json.load(file)
                logging.info(f"Tasks loaded from {self.data_file}.")

    def save_tasks(self) -> None:
        """
        Saves scheduled tasks to a file.
        """
        with self._lock:
            with open(self.data_file, 'w') as file:
                json.dump(self.tasks, file)
            logging.info(f"Tasks saved to {self.data_file}.")

    def add_task(self, task_name: str, function: Callable, interval: Optional[int] = None, run_at: Optional[datetime] = None) -> None:
        """
        Adds a task to the scheduler, either to run at a specific interval or at a specific time.
        Args:
            task_name (str): The name of the task.
            function (Callable): The function to run.
            interval (Optional[int]): The interval in seconds to run the task. Use for repeated tasks.
            run_at (Optional[datetime]): The specific time to run the task. Use for one-time tasks.
        """
        with self._lock:
            next_run = time.time() + interval if interval else run_at.timestamp() if run_at else time.time()
            task = {
                'task_name': task_name,
                'function': function,
                'interval': interval,
                'next_run': next_run,
                'run_at': run_at.timestamp() if run_at else None
            }
            self.tasks.append(task)
            self.save_tasks()
            logging.info(f"Task '{task_name}' added to the scheduler.")

    def remove_task(self, task_name: str) -> None:
        """
        Removes a task from the scheduler.
        Args:
            task_name (str): The name of the task to remove.
        """
        with self._lock:
            self.tasks = [task for task in self.tasks if task['task_name'] != task_name]
            self.save_tasks()
            logging.info(f"Task '{task_name}' removed from the scheduler.")

    def run(self) -> None:
        """
        Runs the scheduler, executing tasks at their scheduled intervals or times.
        """
        logging.info("Scheduler started.")
        try:
            while not self._stop_event.is_set():
                now = time.time()
                with self._lock:
                    tasks_to_remove = []
                    for task in self.tasks:
                        if now >= task['next_run']:
                            logging.info(f"Running task '{task['task_name']}'")
                            thread = threading.Thread(target=self._run_task, args=(task,))
                            thread.start()

                            if task['interval']:  # Repeated tasks
                                task['next_run'] = now + task['interval']
                            elif task['run_at']:  # One-time task
                                tasks_to_remove.append(task)
                    # Remove completed one-time tasks
                    if tasks_to_remove:
                        self.tasks = [task for task in self.tasks if task not in tasks_to_remove]
                        self.save_tasks()

                time.sleep(1)  # Adjust the scheduler frequency as needed
        except Exception as e:
            logging.error(f"Error running scheduler: {e}")

    def _run_task(self, task: Dict[str, Any]) -> None:
        """
        Runs the actual task in a separate thread and handles any errors.
        Args:
            task (Dict[str, Any]): The task to run.
        """
        try:
            task['function']()
            logging.info(f"Task '{task['task_name']}' completed successfully.")
        except Exception as e:
            logging.error(f"Error running task '{task['task_name']}': {e}")

    def stop(self) -> None:
        """
        Stops the scheduler gracefully.
        """
        logging.info("Stopping scheduler...")
        self._stop_event.set()

    def add_task_at_specific_time(self, task_name: str, function: Callable, hour: int, minute: int, second: int) -> None:
        """
        Adds a task to be executed at a specific time of day (e.g., 14:30:00).
        Args:
            task_name (str): The name of the task.
            function (Callable): The function to run.
            hour (int): The hour at which to run the task.
            minute (int): The minute at which to run the task.
            second (int): The second at which to run the task.
        """
        now = datetime.now()
        run_at = now.replace(hour=hour, minute=minute, second=second, microsecond=0)
        if run_at < now:
            run_at += timedelta(days=1)  # Schedule for the next day if time has passed today
        self.add_task(task_name, function, run_at=run_at)
        logging.info(f"Task '{task_name}' scheduled to run at {run_at.strftime('%H:%M:%S')}.")

    def list_tasks(self) -> None:
        """
        Lists all scheduled tasks with their next run times.
        """
        logging.info("Scheduled tasks:")
        with self._lock:
            for task in self.tasks:
                run_time = datetime.fromtimestamp(task['next_run']).strftime('%Y-%m-%d %H:%M:%S')
                logging.info(f"Task '{task['task_name']}' scheduled to run at {run_time}")


if __name__ == "__main__":
    # Example usage of the Scheduler
    def example_task():
        print("Task executed!")

    scheduler = Scheduler()

    # Add a task that runs every 5 seconds
    scheduler.add_task("Example Task", example_task, interval=5)

    # Schedule a task at a specific time (e.g., 14:30:00)
    scheduler.add_task_at_specific_time("Daily Task", example_task, 14, 30, 0)

    try:
        scheduler.run()
    except KeyboardInterrupt:
        scheduler.stop()
        logging.info("Scheduler stopped.")
