# utils/data_preprocessing.py
import os
from PIL import Image

def resize_images(input_folder, output_folder, size=(224, 224)):
    """Resizes all images in the input folder and saves to the output folder"""
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)
    
    for filename in os.listdir(input_folder):
        if filename.endswith(('.png', '.jpg', '.jpeg')):
            img = Image.open(os.path.join(input_folder, filename))
            img_resized = img.resize(size)
            img_resized.save(os.path.join(output_folder, filename))
