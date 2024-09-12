import logging
import cv2
import speech_recognition as sr
import os

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class FaceGestureRecognition:
    """
    A class for face gesture recognition and speech recognition using video and audio inputs.
    """

    def __init__(self, camera_index: int = 0):
        """
        Initializes the FaceGestureRecognition class with a specified camera index.

        Args:
            camera_index (int): The index of the camera to use (default is 0).
        """
        self.camera_index = camera_index
        self.recognizer = sr.Recognizer()
        logging.info(f"FaceGestureRecognition initialized with camera index {self.camera_index}")

    def select_camera(self) -> cv2.VideoCapture:
        """
        Selects and returns a video capture object for the specified camera index.

        Returns:
            cv2.VideoCapture: A video capture object for the specified camera index.

        Raises:
            ValueError: If the camera index is invalid or the camera cannot be accessed.
        """
        try:
            logging.info(f"Attempting to open camera with index {self.camera_index}")
            cap = cv2.VideoCapture(self.camera_index)
            if not cap.isOpened():
                raise ValueError(f"Cannot access camera with index {self.camera_index}")
            logging.info(f"Camera {self.camera_index} opened successfully.")
            return cap
        except Exception as e:
            logging.error(f"Error selecting camera: {e}")
            raise

    def capture_audio(self) -> sr.AudioData:
        """
        Captures audio input from the microphone.

        Returns:
            sr.AudioData: Captured audio data.

        Raises:
            sr.WaitTimeoutError: If no phrase is detected within the timeout period.
            Exception: If any error occurs during audio capture.
        """
        try:
            with sr.Microphone() as source:
                logging.info("Adjusting for ambient noise...")
                self.recognizer.adjust_for_ambient_noise(source)
                logging.info("Listening for audio input...")
                audio = self.recognizer.listen(source)
            logging.info("Audio captured successfully.")
            return audio
        except sr.WaitTimeoutError as e:
            logging.error(f"No phrase detected within the timeout period: {e}")
            raise
        except Exception as e:
            logging.error(f"An error occurred during audio capture: {e}")
            raise

    def recognize_speech(self, audio: sr.AudioData, language: str = "en-US") -> str:
        """
        Recognizes speech from audio data using Google Web Speech API.

        Args:
            audio (sr.AudioData): The audio data to recognize.
            language (str): The language code for the recognition (default is 'en-US').

        Returns:
            str: The recognized text from the audio.

        Raises:
            sr.RequestError: If the API was unreachable or unresponsive.
            sr.UnknownValueError: If speech was unintelligible.
            Exception: If any other error occurs during recognition.
        """
        try:
            logging.info(f"Recognizing speech using language: {language}")
            text = self.recognizer.recognize_google(audio, language=language)
            logging.info(f"Recognized text: {text}")
            return text
        except sr.RequestError as e:
            logging.error(f"API was unreachable or unresponsive: {e}")
            raise
        except sr.UnknownValueError:
            logging.error("Unable to recognize any speech from the audio.")
            raise
        except Exception as e:
            logging.error(f"An error occurred during speech recognition: {e}")
            raise

    def process_video(self, cap: cv2.VideoCapture):
        """
        Processes video frames to detect face gestures.

        Args:
            cap (cv2.VideoCapture): Video capture object.

        Raises:
            Exception: If any error occurs during video processing.
        """
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    logging.error("Failed to grab frame.")
                    break

                # Placeholder for face gesture detection logic
                cv2.imshow('Frame', frame)

                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break

            cap.release()
            cv2.destroyAllWindows()
            logging.info("Video processing completed.")
        except Exception as e:
            logging.error(f"An error occurred during video processing: {e}")
            raise


if __name__ == "__main__":
    # Example usage of FaceGestureRecognition class with error handling
    fgr = FaceGestureRecognition(camera_index=0)

    try:
        cap = fgr.select_camera()
        fgr.process_video(cap)

        audio_data = fgr.capture_audio()
        recognized_text = fgr.recognize_speech(audio_data, language="en-US")
        print(f"Recognized Text: {recognized_text}")

    except Exception as e:
        print(f"An error occurred: {e}")
