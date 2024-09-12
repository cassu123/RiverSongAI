# E:\River Song\ai_modules\text_to_speech\text_to_speech.py

import logging
from gtts import gTTS
from typing import Optional
import playsound

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class TextToSpeech:
    """
    A class to handle text-to-speech conversion using Google Text-to-Speech (gTTS).

    Attributes
    ----------
    language : str
        The language for the TTS.
    voice : str
        The voice type to be used for speech synthesis (default is 'default').
    slow : bool
        Whether the speech should be slow.
    
    Methods
    -------
    speak(text: str) -> None
        Converts the provided text to speech and plays it.
    set_language(language: str) -> None
        Sets the language for text-to-speech conversion.
    set_voice(voice: str) -> None
        Sets the voice type for speech synthesis.
    set_speed(slow: bool) -> None
        Sets the speed for the TTS.
    text_to_speech(text: str, output_file: Optional[str] = None) -> str
        Converts text to speech and saves it to a file.
    play_audio(file_path: str) -> None
        Plays the audio file.
    """

    def __init__(self, language: str = 'en', voice: str = 'default', slow: bool = False):
        """
        Initializes the TextToSpeech class with a language, voice type, and speed.

        Parameters
        ----------
        language : str
            The language to be used for speech synthesis (default is 'en').
        voice : str
            The voice type to be used for speech synthesis (default is 'default').
        slow : bool
            Whether the speech should be slow (default is False).
        """
        self.language = language
        self.voice = voice
        self.slow = slow
        logging.info("TextToSpeech module initialized with language: %s, voice: %s, slow: %s", self.language, self.voice, self.slow)

    def set_language(self, language: str) -> None:
        """
        Sets the language for text-to-speech conversion.

        Parameters
        ----------
        language : str
            The new language code for TTS.
        """
        try:
            self.language = language
            logging.info("Language set to: %s", self.language)
        except Exception as e:
            logging.error("Error setting language: %s", e)
            raise

    def set_voice(self, voice: str) -> None:
        """
        Sets the voice type for speech synthesis.

        Parameters
        ----------
        voice : str
            The voice type to set for speech synthesis.
        """
        try:
            self.voice = voice
            logging.info("Voice set to: %s", self.voice)
        except Exception as e:
            logging.error("Error setting voice: %s", e)
            raise

    def set_speed(self, slow: bool) -> None:
        """
        Sets the speed for the TTS.

        Parameters
        ----------
        slow : bool
            Whether the speech should be slow.
        """
        try:
            self.slow = slow
            logging.info("Speed set to slow: %s", self.slow)
        except Exception as e:
            logging.error("Error setting speed: %s", e)
            raise

    def text_to_speech(self, text: str, output_file: Optional[str] = None) -> str:
        """
        Converts text to speech and saves it to a file.

        Parameters
        ----------
        text : str
            The text to convert to speech.
        output_file : Optional[str]
            The file path to save the audio. If None, saves as 'output.mp3'.

        Returns
        -------
        str
            The path to the saved audio file.

        Raises
        ------
        ValueError
            If the text is empty.
        Exception
            If an error occurs during the TTS conversion or file saving.
        """
        if not text.strip():
            logging.error("The text for conversion is empty.")
            raise ValueError("The text for conversion must not be empty.")

        if not output_file:
            output_file = "output.mp3"

        try:
            tts = gTTS(text=text, lang=self.language, slow=self.slow)
            tts.save(output_file)
            logging.info("Text converted to speech and saved to %s.", output_file)
            return output_file
        except Exception as e:
            logging.error("Error in text_to_speech: %s", e)
            raise

    def play_audio(self, file_path: str) -> None:
        """
        Plays the audio file.

        Parameters
        ----------
        file_path : str
            The path to the audio file to play.

        Raises
        ------
        FileNotFoundError
            If the audio file does not exist.
        Exception
            If an error occurs while playing the audio file.
        """
        try:
            playsound.playsound(file_path)
            logging.info("Playing audio file: %s", file_path)
        except FileNotFoundError:
            logging.error("Audio file not found: %s", file_path)
            raise
        except Exception as e:
            logging.error("Error playing audio file: %s", e)
            raise

if __name__ == "__main__":
    # Example usage of TextToSpeech
    tts = TextToSpeech()
    try:
        audio_file = tts.text_to_speech("Hello, welcome to the River Song project!")
        tts.play_audio(audio_file)
    except Exception as e:
        logging.error("An error occurred: %s", e)
