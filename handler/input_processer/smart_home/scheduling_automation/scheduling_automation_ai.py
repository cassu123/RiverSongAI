import logging
import pandas as pd
import numpy as np
from typing import List, Tuple, Dict, Any, Optional
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, classification_report
from datetime import datetime, timedelta
import matplotlib.pyplot as plt

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class SchedulingAutomationAI:
    """
    A class to automate and optimize scheduling tasks using AI.
    """

    def __init__(self, model: Optional[Any] = None):
        """
        Initialize the SchedulingAutomationAI class.

        Args:
            model (Any): Optional. A pre-trained machine learning model. Defaults to None.
        """
        self.data = None
        self.preprocessed_data = None
        self.model = model or RandomForestClassifier()
        self.constraints = []
        logging.info("SchedulingAutomationAI initialized.")

    def load_data(self, file_path: str) -> None:
        """
        Load scheduling data from a file.

        Args:
            file_path (str): The path to the data file.
        """
        self.data = pd.read_csv(file_path)
        logging.info(f"Data loaded from {file_path}")

    def preprocess_data(self) -> None:
        """
        Preprocess the scheduling data for model training.
        """
        # Example preprocessing logic
        self.preprocessed_data = self.data.copy()
        self.preprocessed_data['duration'] = pd.to_datetime(self.preprocessed_data['end_time']) - pd.to_datetime(self.preprocessed_data['start_time'])
        self.preprocessed_data['duration'] = self.preprocessed_data['duration'].dt.total_seconds()
        logging.info("Data preprocessed.")

    def train_model(self, test_size: float = 0.2, random_state: int = 42) -> None:
        """
        Train the machine learning model on the preprocessed data.

        Args:
            test_size (float): The proportion of data to use for testing. Defaults to 0.2.
            random_state (int): The random state for data splitting. Defaults to 42.
        """
        X = self.preprocessed_data.drop(['task_id', 'start_time', 'end_time', 'duration'], axis=1)
        y = self.preprocessed_data['duration']

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size, random_state=random_state)
        self.model.fit(X_train, y_train)
        y_pred = self.model.predict(X_test)

        logging.info("Model trained.")
        logging.info(f"Model accuracy: {accuracy_score(y_test, y_pred)}")
        logging.info(f"Confusion Matrix:\n{confusion_matrix(y_test, y_pred)}")
        logging.info(f"Classification Report:\n{classification_report(y_test, y_pred)}")

    def generate_schedule(self) -> List[Dict[str, Any]]:
        """
        Generate an optimized schedule based on the trained model and constraints.

        Returns:
            List[Dict[str, Any]]: A list of scheduled tasks.
        """
        schedule = []
        for _, row in self.data.iterrows():
            task_duration = self.model.predict(row.drop(['task_id', 'start_time', 'end_time']))
            start_time = pd.to_datetime(row['start_time'])
            end_time = start_time + timedelta(seconds=task_duration)
            schedule.append({
                'task_id': row['task_id'],
                'start_time': start_time,
                'end_time': end_time
            })

        logging.info("Schedule generated.")
        return schedule

    def add_constraints(self, constraints: List[Tuple[int, int]]) -> None:
        """
        Add constraints to the scheduling process.

        Args:
            constraints (List[Tuple[int, int]]): List of task dependencies.
        """
        self.constraints.extend(constraints)
        logging.info(f"Constraints added: {constraints}")

    def check_constraints(self, schedule: List[Dict[str, Any]]) -> bool:
        """
        Check if the generated schedule satisfies all constraints.

        Args:
            schedule (List[Dict[str, Any]]): The generated schedule.

        Returns:
            bool: True if all constraints are satisfied, False otherwise.
        """
        for task1, task2 in self.constraints:
            task1_end = next(item for item in schedule if item["task_id"] == task1)["end_time"]
            task2_start = next(item for item in schedule if item["task_id"] == task2)["start_time"]
            if task1_end > task2_start:
                logging.warning(f"Constraint violated between tasks {task1} and {task2}.")
                return False
        logging.info("All constraints satisfied.")
        return True

    def visualize_schedule(self, schedule: List[Dict[str, Any]]) -> None:
        """
        Visualize the generated schedule.

        Args:
            schedule (List[Dict[str, Any]]): The generated schedule.
        """
        plt.figure(figsize=(10, 6))
        for task in schedule:
            plt.plot([task['start_time'], task['end_time']], [task['task_id'], task['task_id']], marker='o')
        plt.xlabel('Time')
        plt.ylabel('Task ID')
        plt.title('Generated Schedule')
        plt.show()
        logging.info("Schedule visualization complete.")


# Example usage
if __name__ == "__main__":
    ai = SchedulingAutomationAI()
    ai.load_data('data.csv')
    ai.preprocess_data()
    ai.train_model()
    schedule = ai.generate_schedule()
    if ai.check_constraints(schedule):
        ai.visualize_schedule(schedule)
    else:
        logging.error("Generated schedule does not satisfy all constraints.")
