import cv2

class ImageSegmenter:
    def segment_image(self, image_path):
        image = cv2.imread(image_path)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        ret, thresh = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY)
        return thresh
