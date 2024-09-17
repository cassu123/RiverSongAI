import tensorflow as tf
from tensorflow.keras.models import load_model

class ImageClassifier:
    def __init__(self):
        self.model = load_model('pretrained_image_classifier.h5')

    def classify_image(self, image_path):
        image = tf.keras.preprocessing.image.load_img(image_path, target_size=(224, 224))
        image = tf.keras.preprocessing.image.img_to_array(image)
        image = tf.expand_dims(image, axis=0)
        predictions = self.model.predict(image)
        return predictions
