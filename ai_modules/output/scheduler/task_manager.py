class TaskManager:
    def __init__(self):
        self.tasks = []

    def add_task(self, task_name, due_date=None, priority="normal"):
        """Adds a new task with optional due date and priority."""
        task = {
            "task_name": task_name,
            "due_date": due_date,
            "priority": priority,
            "completed": False
        }
        self.tasks.append(task)
        print(f"Task added: {task_name}")

    def list_tasks(self):
        """Lists all tasks."""
        return self.tasks

    def mark_task_complete(self, task_name):
        """Marks a task as complete."""
        for task in self.tasks:
            if task["task_name"] == task_name:
                task["completed"] = True
                print(f"Task completed: {task_name}")
                break

    def remove_task(self, task_name):
        """Removes a task from the task list."""
        self.tasks = [task for task in self.tasks if task["task_name"] != task_name]
        print(f"Task removed: {task_name}")

    def prioritize_tasks(self):
        """Prioritizes tasks based on their priority and due date."""
        self.tasks.sort(key=lambda x: (x["priority"], x["due_date"]))
        return self.tasks
