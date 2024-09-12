from tensorflow.keras.preprocessing.image import ImageDataGenerator
from torchvision import datasets, transforms
from torch.utils.data import DataLoader
import os

def load_and_preprocess_data_tf(data_dir, input_size=(224, 224), batch_size=32):
    # Your TensorFlow data loading code here
    ...

def load_and_preprocess_data_torch(data_dir, input_size=(224, 224), batch_size=32, dataset_type='ImageFolder'):
    # Your PyTorch data loading code here
    ...
