from tensorflow.keras.models import load_model
import numpy as np

class GestureModel:
    def __init__(self, model_path="models/gesture_model_weights.h5"):
        self.model = load_model(model_path)

    def predict(self, features):
        """
        Predict the gesture based on extracted features.
        """
        predictions = self.model.predict(np.array([features]))
        predicted_gesture = np.argmax(predictions, axis=1)[0]
        
        gesture_map = {
            0: "swipe_left",
            1: "swipe_right",
            2: "zoom_in",
            3: "zoom_out"
        }
        
        return gesture_map.get(predicted_gesture, "unknown")

if __name__ == "__main__":
    model = GestureModel()
    
    # Placeholder features
    features = np.random.random((1, 20))
    
    gesture = model.predict(features)
    print(f"Predicted Gesture: {gesture}")
