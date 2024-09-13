import librosa
import numpy as np

class VoiceFeatureExtractor:
    def __init__(self):
        pass

    def extract_voice_features(self, audio_path):
        """
        Extract voice features from the given audio file.
        We use MFCC (Mel-frequency cepstral coefficients) for feature extraction.
        """
        y, sr = librosa.load(audio_path, sr=None)
        mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
        return np.mean(mfccs, axis=1)

if __name__ == "__main__":
    extractor = VoiceFeatureExtractor()
    audio_file = "path_to_audio_file.wav"  # Replace with the actual audio file path

    features = extractor.extract_voice_features(audio_file)
    print(f"Extracted Voice Features: {features}")
