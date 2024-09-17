class TaskPrioritizationAI:
    def __init__(self):
        self.tasks = []

    def add_task(self, task, deadline):
        self.tasks.append({"task": task, "deadline": deadline})

    def prioritize_tasks(self):
        # Simple task prioritization based on deadline
        self.tasks.sort(key=lambda x: x['deadline'])
        return self.tasks
