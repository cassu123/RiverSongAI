config = {
    "model_name": "ResNet50",    # Change model type (e.g., VGG16, MobileNetV2)
    "num_classes": 10,           # Number of output classes
    "input_size": (224, 224),    # Input image size
    "batch_size": 32,            # Batch size for training
    "epochs": 10,                # Number of training epochs
    "learning_rate": 0.001,      # Learning rate for optimizer
    "dataset_type": "ImageFolder", # Type of dataset (e.g., CIFAR10, ImageFolder)
    "use_tensorflow": False      # Whether to use TensorFlow (True) or PyTorch (False)
}
