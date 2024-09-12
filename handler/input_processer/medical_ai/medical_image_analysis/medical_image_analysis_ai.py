# medical_image_analysis.py

import logging
import numpy as np
import cv2
import pydicom
import SimpleITK as sitk
import nibabel as nib
from skimage import exposure, img_as_float
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class MedicalImageAnalysis:
    """
    A class for handling medical image analysis tasks, including loading, preprocessing, 
    visualization, segmentation, classification, and anomaly detection.
    """

    def __init__(self):
        """
        Initializes the MedicalImageAnalysis class.
        """
        logging.info("MedicalImageAnalysis initialized.")

    def load_image(self, filepath: str):
        """
        Loads a medical image from the specified file path.

        Args:
            filepath (str): Path to the medical image file.

        Returns:
            np.ndarray or sitk.Image: Loaded image as a NumPy array or SimpleITK Image.

        Raises:
            FileNotFoundError: If the file cannot be found.
            ValueError: If the file format is unsupported.
        """
        try:
            if filepath.endswith('.dcm'):
                logging.info(f"Loading DICOM image from {filepath}")
                ds = pydicom.dcmread(filepath)
                image = ds.pixel_array
            elif filepath.endswith('.nii') or filepath.endswith('.nii.gz'):
                logging.info(f"Loading NIfTI image from {filepath}")
                image = nib.load(filepath).get_fdata()
            else:
                logging.info(f"Loading standard image from {filepath}")
                image = cv2.imread(filepath, cv2.IMREAD_GRAYSCALE)
                if image is None:
                    raise ValueError(f"Unsupported file format or corrupted file: {filepath}")
            return image
        except FileNotFoundError as e:
            logging.error(f"File not found: {e}")
            raise
        except Exception as e:
            logging.error(f"Error loading image: {e}")
            raise

    def preprocess_image(self, image, resize_dims=(256, 256)):
        """
        Preprocesses a medical image by resizing and normalizing.

        Args:
            image (np.ndarray): Input image to preprocess.
            resize_dims (tuple): Dimensions to resize the image to.

        Returns:
            np.ndarray: Preprocessed image.

        Raises:
            Exception: If an error occurs during preprocessing.
        """
        try:
            logging.info("Preprocessing image")
            # Convert image to float for better precision during processing
            image = img_as_float(image)
            # Resize image
            preprocessed_image = cv2.resize(image, resize_dims, interpolation=cv2.INTER_AREA)
            # Normalize image
            preprocessed_image = exposure.equalize_adapthist(preprocessed_image)
            return preprocessed_image
        except Exception as e:
            logging.error(f"Error preprocessing image: {e}")
            raise

    def visualize_image(self, image, title="Medical Image"):
        """
        Visualizes a medical image.

        Args:
            image (np.ndarray): Image to visualize.
            title (str): Title for the image window.

        Raises:
            Exception: If an error occurs during visualization.
        """
        try:
            logging.info("Visualizing image")
            cv2.imshow(title, image)
            cv2.waitKey(0)
            cv2.destroyAllWindows()
        except Exception as e:
            logging.error(f"Error visualizing image: {e}")
            raise

    def segment_image(self, image):
        """
        Segments a medical image using a basic thresholding technique.

        Args:
            image (np.ndarray): Image to segment.

        Returns:
            np.ndarray: Segmented image.

        Raises:
            Exception: If an error occurs during segmentation.
        """
        try:
            logging.info("Segmenting image")
            # Example segmentation using a fixed threshold
            _, segmented_image = cv2.threshold(image, 128, 255, cv2.THRESH_BINARY)
            return segmented_image
        except Exception as e:
            logging.error(f"Error segmenting image: {e}")
            raise

    def classify_image(self, image, model=None):
        """
        Classifies a medical image using a pre-trained model.

        Args:
            image (np.ndarray): Image to classify.
            model: Machine learning model to use for classification.

        Returns:
            str: Classification result.

        Raises:
            Exception: If an error occurs during classification.
        """
        try:
            logging.info("Classifying image")
            if model is None:
                logging.warning("No model provided, using default RandomForestClassifier.")
                model = RandomForestClassifier()

            # Example feature extraction
            features = image.flatten().reshape(1, -1)
            prediction = model.predict(features)
            return prediction
        except Exception as e:
            logging.error(f"Error classifying image: {e}")
            raise

    def detect_anomalies(self, image):
        """
        Detects anomalies in a medical image using a simple method.

        Args:
            image (np.ndarray): Image to analyze for anomalies.

        Returns:
            np.ndarray: Image with detected anomalies highlighted.

        Raises:
            Exception: If an error occurs during anomaly detection.
        """
        try:
            logging.info("Detecting anomalies")
            # Placeholder for anomaly detection logic
            anomalies = image.copy()
            # Example using simple thresholding to highlight anomalies
            anomalies[anomalies < 128] = 0
            return anomalies
        except Exception as e:
            logging.error(f"Error detecting anomalies: {e}")
            raise

    def train_model(self, X, y):
        """
        Trains a machine learning model on the provided data.

        Args:
            X (np.ndarray): Training data.
            y (np.ndarray): Labels for the training data.

        Returns:
            model: Trained machine learning model.

        Raises:
            Exception: If an error occurs during model training.
        """
        try:
            logging.info("Training machine learning model")
            model = RandomForestClassifier()
            model.fit(X, y)
            return model
        except Exception as e:
            logging.error(f"Error training model: {e}")
            raise

    def evaluate_model(self, model, X_test, y_test):
        """
        Evaluates a machine learning model.

        Args:
            model: Machine learning model to evaluate.
            X_test (np.ndarray): Test data.
            y_test (np.ndarray): Labels for the test data.

        Returns:
            dict: Dictionary of evaluation metrics.

        Raises:
            Exception: If an error occurs during model evaluation.
        """
        try:
            logging.info("Evaluating machine learning model")
            y_pred = model.predict(X_test)
            metrics = {
                'accuracy': accuracy_score(y_test, y_pred),
                'precision': precision_score(y_test, y_pred, average='weighted'),
                'recall': recall_score(y_test, y_pred, average='weighted'),
                'f1_score': f1_score(y_test, y_pred, average='weighted')
            }
            return metrics
        except Exception as e:
            logging.error(f"Error evaluating model: {e}")
            raise


if __name__ == "__main__":
    # Example usage
    analysis = MedicalImageAnalysis()
    
    # Load an image (replace with actual path to image)
    image_path = 'example_image.dcm'
    try:
        image = analysis.load_image(image_path)
        preprocessed_image = analysis.preprocess_image(image)
        analysis.visualize_image(preprocessed_image)
        segmented_image = analysis.segment_image(preprocessed_image)
        analysis.visualize_image(segmented_image, title="Segmented Image")
        
        # Placeholder for training and evaluation data
        X_train, X_test, y_train, y_test = train_test_split(np.random.rand(100, 256*256), np.random.randint(0, 2, 100), test_size=0.2)
        model = analysis.train_model(X_train, y_train)
        metrics = analysis.evaluate_model(model, X_test, y_test)
        logging.info(f"Model metrics: {metrics}")
    except Exception as e:
        logging.error(f"An error occurred: {e}")
