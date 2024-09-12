# face_gesture_recognition_ai.py
import torch
import torch.nn as nn
import torchvision.transforms as transforms
from PIL import Image

class FaceGestureRecognitionAI:
    def __init__(self, model_path):
        # Load pre-trained model for face and gesture recognition
        self.model = torch.load(model_path)
        self.model.eval()  # Set model to evaluation mode
        
        # Transformation for input images (normalize and resize)
        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        ])
    
    def predict(self, image_path):
        # Load image and apply transformations
        image = Image.open(image_path).convert('RGB')
        image = self.transform(image).unsqueeze(0)  # Add batch dimension
        
        # Make prediction
        with torch.no_grad():
            output = self.model(image)
            _, predicted_class = torch.max(output, 1)
        
        return predicted_class.item()

    def load_model(self, model_path):
        self.model = torch.load(model_path)
        self.model.eval()

