import cv2

class VideoStreamProcessor:
    def __init__(self, video_source):
        self.video_source = video_source

    def process_stream(self):
        cap = cv2.VideoCapture(self.video_source)

        if not cap.isOpened():
            print("Error: Could not open video stream.")
            return

        while True:
            ret, frame = cap.read()
            if not ret:
                print("Failed to grab frame.")
                break

            # Processing each frame (resize, convert, etc.)
            frame_resized = cv2.resize(frame, (640, 480))

            cv2.imshow("Video Stream", frame_resized)

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

        cap.release()
        cv2.destroyAllWindows()
