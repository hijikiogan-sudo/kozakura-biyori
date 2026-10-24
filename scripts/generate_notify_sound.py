"""Generate notify.caf, the iOS notification sound. Run: python3 scripts/generate_notify_sound.py

iOS local notifications are silent unless a sound is named, so native.js names this bundled file.
Written into the iOS app target (ios/App/App), which copies it to the top of the app bundle.
A two-note chime (about 1.2 s), converted with macOS afconvert to 16-bit little-endian PCM in a CAF file,
the format Apple documents for notification sounds; a plain WAV played silently on an iPhone.
"""
import math
from pathlib import Path
import struct
import subprocess
import tempfile
import wave

RATE = 44100
NOTES = [(0.0, 1046.5), (0.22, 1318.5)]  # C6 then E6
LENGTH = 1.2


def sample(t):
    value = 0.0
    for start, freq in NOTES:
        if t < start:
            continue
        local = t - start
        envelope = min(1.0, local / 0.01) * math.exp(-local * 3.5)
        value += envelope * (math.sin(2 * math.pi * freq * local) + 0.25 * math.sin(4 * math.pi * freq * local))
    return value * 0.6


def main():
    # iOS only finds notification sounds at the top level of the app bundle, not inside public/.
    out = Path(__file__).resolve().parents[1] / 'ios/App/App/notify.caf'
    frames = b''.join(struct.pack('<h', max(-32767, min(32767, int(sample(i / RATE) * 32767)))) for i in range(int(RATE * LENGTH)))
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / 'notify.wav'
        with wave.open(str(wav), 'wb') as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(RATE)
            f.writeframes(frames)
        subprocess.run(['afconvert', '-f', 'caff', '-d', 'LEI16@44100', '-c', '1', str(wav), str(out)], check=True)

if __name__ == '__main__':
    main()
