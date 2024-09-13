from tensorflow.keras.models import load_model
import numpy as np

class VoiceCommandModel:
    def __init__(self, model_path="models/voice_command_model_weights.h5"):
        self.model = load_model(model_path)

    def predict(self, features):
        """
        Predict the voice command based on extracted features.
        """
        predictions = self.model.predict(np.array([features]))
        predicted_command = np.argmax(predictions, axis=1)[0]
        
        command_map = {
            0: "turn_on_lights",
            1: "turn_off_lights",
            2: "increase_volume",
            3: "decrease_volume"
        }
        
        return command_map.get(predicted_command, "unknown")

if __name__ == "__main__":
    model = VoiceCommandModel()
    
    # Placeholder features
    features = np.random.random((1, 13))  # Example feature vector (13 MFCC features)
    
    command = model.predict(features)
    print(f"Predicted Command: {command}")
