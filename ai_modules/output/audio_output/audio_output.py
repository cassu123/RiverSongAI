import os
import pygame

class AudioOutput:
    def __init__(self):
        # Initialize the pygame mixer for audio playback
        pygame.mixer.init()

    def play_sound(self, sound_file):
        """Plays a specified sound file"""
        if os.path.exists(sound_file):
            pygame.mixer.music.load(sound_file)
            pygame.mixer.music.play()
            print(f"Playing sound: {sound_file}")
        else:
            print(f"Error: Sound file {sound_file} does not exist.")

    def stop_sound(self):
        """Stops any playing sound"""
        pygame.mixer.music.stop()
        print("Sound stopped.")

    def set_volume(self, volume_level):
        """Sets the audio volume (range: 0.0 to 1.0)"""
        pygame.mixer.music.set_volume(volume_level)
        print(f"Volume set to: {volume_level * 100}%")
