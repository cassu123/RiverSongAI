import numpy as np
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Dense, Dropout
from sklearn.model_selection import train_test_split

class VoiceCommandModelTrainer:
    def __init__(self, model_save_path="models/voice_command_model_weights.h5"):
        self.model_save_path = model_save_path

    def load_data(self, dataset_path):
        """
        Load and preprocess the voice command dataset.
        The dataset should be a CSV with features and labels.
        """
        # Placeholder: Random data simulating a dataset with 1000 samples and 13 features (MFCCs)
        data = np.random.random((1000, 13))  # 1000 samples, 13 MFCC features
        labels = np.random.randint(0, 4, 1000)  # 4 possible commands (turn on, turn off, etc.)

        return train_test_split(data, labels, test_size=0.2, random_state=42)

    def build_model(self, input_shape):
        """
        Build and compile a simple neural network for voice command recognition.
        """
        model = Sequential()
        model.add(Dense(64, activation='relu', input_shape=(input_shape,)))
        model.add(Dropout(0.5))
        model.add(Dense(32, activation='relu'))
        model.add(Dense(4, activation='softmax'))  # Assuming 4 possible voice commands
        
        model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
        return model

    def train_model(self, X_train, y_train, X_val, y_val, epochs=10, batch_size=32):
        """
        Train the voice command recognition model.
        """
        model = self.build_model(X_train.shape[1])
        
        # Train the model
        history = model.fit(X_train, y_train, validation_data=(X_val, y_val), epochs=epochs, batch_size=batch_size)

        # Save the trained model
        model.save(self.model_save_path)
        print(f"Model saved to {self.model_save_path}")

if __name__ == "__main__":
    trainer = VoiceCommandModelTrainer()

    # Load dataset
    dataset_path = "datasets/voice_command_dataset.csv"  # Replace with actual dataset path
    X_train, X_val, y_train, y_val = trainer.load_data(dataset_path)

    # Train the model
    trainer.train_model(X_train, y_train, X_val, y_val, epochs=15, batch_size=64)
