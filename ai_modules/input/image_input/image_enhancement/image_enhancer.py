import cv2

class ImageEnhancer:
    def enhance(self, image_path):
        image = cv2.imread(image_path)
        enhanced_image = cv2.detailEnhance(image, sigma_s=10, sigma_r=0.15)
        return enhanced_image
