import cv2

class ObjectTracker:
    def __init__(self):
        self.tracker = cv2.TrackerKCF_create()

    def track(self, frame, bbox):
        success, bbox = self.tracker.update(frame)
        if success:
            print("Tracking object...")
        else:
            print("Failed to track object.")
        return success, bbox
