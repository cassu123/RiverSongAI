import pyaudio
import numpy as np
import time
from scipy.io import wavfile

class NoiseDetector:
    def __init__(self, threshold=1000, chunk_size=1024, format=pyaudio.paInt16, channels=1, rate=44100):
        self.threshold = threshold
        self.chunk_size = chunk_size
        self.format = format
        self.channels = channels
        self.rate = rate
        self.audio = pyaudio.PyAudio()
        
    def start_stream(self):
        self.stream = self.audio.open(format=self.format,
                                      channels=self.channels,
                                      rate=self.rate,
                                      input=True,
                                      frames_per_buffer=self.chunk_size)
    
    def stop_stream(self):
        self.stream.stop_stream()
        self.stream.close()
        self.audio.terminate()
    
    def detect_noise(self):
        print("Listening for noise...")
        while True:
            data = np.frombuffer(self.stream.read(self.chunk_size), dtype=np.int16)
            peak = np.abs(np.max(data) - np.min(data))
            
            if peak > self.threshold:
                print(f"Noise detected! Peak value: {peak}")
                return True
            time.sleep(0.1)

    def save_audio(self, filename="noise_capture.wav", record_seconds=5):
        print(f"Recording {record_seconds} seconds of audio...")
        frames = []

        for _ in range(0, int(self.rate / self.chunk_size * record_seconds)):
            data = self.stream.read(self.chunk_size)
            frames.append(data)
        
        # Save the recorded audio to a .wav file
        wavfile.write(filename, self.rate, np.frombuffer(b''.join(frames), dtype=np.int16))
        print(f"Audio saved as {filename}")

if __name__ == "__main__":
    detector = NoiseDetector(threshold=1200)  # Adjust the threshold based on environment
    detector.start_stream()

    try:
        if detector.detect_noise():
            detector.save_audio("detected_noise.wav")
    except KeyboardInterrupt:
        print("Exiting...")
    finally:
        detector.stop_stream()
