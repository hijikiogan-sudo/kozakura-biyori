"""Generate notify.wav, the iOS notification sound. Run: python3 scripts/generate_notify_sound.py

iOS local notifications are silent unless a sound is named, so native.js names this bundled file.
A soft two-note chime (about 0.8 s, 16-bit mono WAV), well under iOS's 30-second limit for notification sounds.
"""
import math
from pathlib import Path
import struct
import wave

RATE = 44100
NOTES = [(0.0, 1046.5), (0.22, 1318.5)]  # C6 then E6
LENGTH = 0.85


def sample(t):
    value = 0.0
    for start, freq in NOTES:
        if t < start:
            continue
        local = t - start
        envelope = min(1.0, local / 0.01) * math.exp(-local * 6.0)
        value += envelope * (math.sin(2 * math.pi * freq * local) + 0.25 * math.sin(4 * math.pi * freq * local))
    return value * 0.35


def main():
    out = Path(__file__).resolve().parents[1] / 'notify.wav'
    frames = b''.join(struct.pack('<h', max(-32767, min(32767, int(sample(i / RATE) * 32767)))) for i in range(int(RATE * LENGTH)))
    with wave.open(str(out), 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(frames)


if __name__ == '__main__':
    main()
