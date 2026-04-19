from providers.base import TTSProvider


class NullTTS(TTSProvider):
    """No-op TTS provider. Used when TTS_PROVIDER=none."""

    async def synthesize(self, text: str) -> bytes:
        return b""
