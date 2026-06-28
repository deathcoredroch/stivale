#!/usr/bin/env python3
import sys
import os
from pathlib import Path

try:
    from piper.voice import PiperVoice
except ImportError:
    print("Error: piper-tts not installed", file=sys.stderr)
    sys.exit(1)

def synthesize(text, output_file, voice_key="it_IT/riccardo_gione"):
    """Synthesize text to speech using Piper"""
    try:
        # Load voice (will auto-download model if needed)
        print(f"Loading voice: {voice_key}", file=sys.stderr)
        voice = PiperVoice.load(voice_key)

        # Synthesize to file
        with open(output_file, 'wb') as f:
            voice.synthesize(text, f)

        print(f"✓ Generated: {output_file}", file=sys.stderr)
    except Exception as e:
        print(f"✗ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python piper_tts.py <text> <output_file> [voice_key]", file=sys.stderr)
        sys.exit(1)

    text = sys.argv[1]
    output_file = sys.argv[2]
    voice_key = sys.argv[3] if len(sys.argv) > 3 else "it_IT/riccardo_gione"

    synthesize(text, output_file, voice_key)
