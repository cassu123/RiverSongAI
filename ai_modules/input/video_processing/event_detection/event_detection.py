import cv2

class EventDetection:
    def __init__(self):
        pass  # Placeholder for initialization

    def detect_motion(self, video_feed):
        cap = cv2.VideoCapture(video_feed)
        ret, frame1 = cap.read()
        ret, frame2 = cap.read()

        while cap.isOpened():
            diff = cv2.absdiff(frame1, frame2)
            gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
            blur = cv2.GaussianBlur(gray, (5, 5), 0)
            _, thresh = cv2.threshold(blur, 20, 255, cv2.THRESH_BINARY)
            dilated = cv2.dilate(thresh, None, iterations=3)
            contours, _ = cv2.findContours(dilated, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

            for contour in contours:
                if cv2.contourArea(contour) < 500:
                    continue
                x, y, w, h = cv2.boundingRect(contour)
                cv2.rectangle(frame1, (x, y), (x+w, y+h), (0, 255, 0), 2)

            cv2.imshow("feed", frame1)
            frame1 = frame2
            ret, frame2 = cap.read()

            if cv2.waitKey(40) == 27:  # Press 'ESC' to exit
                break

        cap.release()
        cv2.destroyAllWindows()

    def detect_event(self, video_feed):
        print("Detecting specific event...")
        # Future: Implement specific event detection logic
