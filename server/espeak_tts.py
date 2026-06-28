#!/usr/bin/env python3
import sys
import subprocess
import tempfile

def synthesize_espeak(text, output_file, voice_lang="it"):
    """Synthesize text using espeak-ng"""
    try:
        # espeak-ng command: espeak-ng -v <voice> -w <output.wav> "<text>"
        cmd = [
            'espeak-ng',
            '-v', voice_lang,
            '-w', output_file,
            text
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"Error: {result.stderr}", file=sys.stderr)
            sys.exit(1)

        print(f"✓ Generated: {output_file}", file=sys.stderr)

    except FileNotFoundError:
        print("Error: espeak-ng not found. Install with: scoop install espeak-ng", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"✗ Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python espeak_tts.py <text> <output_file> [voice_lang]", file=sys.stderr)
        sys.exit(1)

    text = sys.argv[1]
    output_file = sys.argv[2]
    voice_lang = sys.argv[3].split('/')[0] if len(sys.argv) > 3 else "it"

    synthesize_espeak(text, output_file, voice_lang)
