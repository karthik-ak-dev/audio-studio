"""Audio processing constants — single source of truth."""

# Output format for ML training
SAMPLE_RATE: int = 48000
BIT_DEPTH: int = 16
CHANNELS: int = 1  # Mono
CODEC: str = "pcm_s16le"

# ffmpeg binary location in Lambda Layer
FFMPEG_PATH: str = "/opt/bin/ffmpeg"

# Processing
FFMPEG_TIMEOUT_SEC: int = 600
EXPECTED_TRACKS_PER_SESSION: int = 2

# Daily.co file naming
AUDIO_TRACK_IDENTIFIER: str = "cam-audio"
