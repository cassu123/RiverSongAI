import cv2
import numpy as np

class ObjectDetector:
    def __init__(self):
        self.net = cv2.dnn.readNet('yolov3.weights', 'yolov3.cfg')
        self.classes = open('coco.names').read().strip().split('\n')

    def detect_objects(self, image_path):
        image = cv2.imread(image_path)
        height, width = image.shape[:2]
        blob = cv2.dnn.blobFromImage(image, 0.00392, (416, 416), swapRB=True, crop=False)
        self.net.setInput(blob)
        layer_names = self.net.getLayerNames()
        output_layers = [layer_names[i[0] - 1] for i in self.net.getUnconnectedOutLayers()]
        detections = self.net.forward(output_layers)

        boxes, confidences, class_ids = [], [], []
        for out in detections:
            for detection in out:
                scores = detection[5:]
                class_id = np.argmax(scores)
                confidence = scores[class_id]
                if confidence > 0.5:
                    center_x, center_y, w, h = (detection[0:4] * [width, height, width, height]).astype('int')
                    x, y = int(center_x - w / 2), int(center_y - h / 2)
                    boxes.append([x, y, w, h])
                    confidences.append(float(confidence))
                    class_ids.append(class_id)

        return boxes, confidences, class_ids
