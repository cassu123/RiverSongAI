import cv2
import numpy as np

class ObjectDetector:
    def __init__(self, model='yolov3'):
        self.model = model
        self.net = self.load_model()

    def load_model(self):
        """Load the YOLO model."""
        if self.model == 'yolov3':
            net = cv2.dnn.readNet('yolov3.weights', 'yolov3.cfg')
            with open('coco.names', 'r') as f:
                self.classes = [line.strip() for line in f.readlines()]
            return net
        else:
            raise ValueError(f"Model {self.model} is not supported yet.")
    
    def detect_objects(self, image_path):
        """Detect objects in an image."""
        image = cv2.imread(image_path)
        height, width = image.shape[:2]
        
        # Convert the image to blob
        blob = cv2.dnn.blobFromImage(image, 0.00392, (416, 416), (0, 0, 0), True, crop=False)
        self.net.setInput(blob)
        
        # Get the layer names
        layer_names = self.net.getLayerNames()
        output_layers = [layer_names[i[0] - 1] for i in self.net.getUnconnectedOutLayers()]
        
        # Forward pass
        detections = self.net.forward(output_layers)
        
        # Process detections
        boxes = []
        confidences = []
        class_ids = []
        
        for out in detections:
            for detection in out:
                scores = detection[5:]
                class_id = np.argmax(scores)
                confidence = scores[class_id]
                if confidence > 0.5:
                    center_x = int(detection[0] * width)
                    center_y = int(detection[1] * height)
                    w = int(detection[2] * width)
                    h = int(detection[3] * height)
                    
                    # Coordinates for the bounding box
                    x = int(center_x - w / 2)
                    y = int(center_y - h / 2)
                    
                    boxes.append([x, y, w, h])
                    confidences.append(float(confidence))
                    class_ids.append(class_id)
        
        # Apply non-maxima suppression
        indices = cv2.dnn.NMSBoxes(boxes, confidences, 0.5, 0.4)
        for i in indices:
            i = i[0]
            box = boxes[i]
            x, y, w, h = box[0], box[1], box[2], box[3]
            label = str(self.classes[class_ids[i]])
            confidence = confidences[i]
            print(f"Detected {label} with confidence {confidence}")
        
        return image

# Example usage
if __name__ == "__main__":
    detector = ObjectDetector(model='yolov3')
    image_path = 'input_image.jpg'
    detected_image = detector.detect_objects(image_path)
    # To show the image with detections (comment this line if not needed)
    cv2.imshow("Object Detection", detected_image)
    cv2.waitKey(0)
    cv2.destroyAllWindows()
