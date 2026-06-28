#!/usr/bin/env python3
import sys
import asyncio

try:
    import edge_tts
except ImportError:
    print("Error: edge-tts not installed", file=sys.stderr)
    sys.exit(1)

VOICE_MAP = {
    'it': 'it-IT-IsabellaNeural',
    'it_IT': 'it-IT-IsabellaNeural',
    'en': 'en-US-AriaNeural',
    'ru': 'ru-RU-SvetlanaNeural',
}

async def synthesize(text, output_file, voice):
    communicate = edge_tts.Communicate(text, voice, rate='-10%')
    await communicate.save(output_file)

def main():
    if len(sys.argv) < 3:
        print("Usage: python tts.py <text> <output_file> [lang]", file=sys.stderr)
        sys.exit(1)

    text = sys.argv[1]
    output_file = sys.argv[2]
    lang = sys.argv[3] if len(sys.argv) > 3 else 'it'
    voice = VOICE_MAP.get(lang, VOICE_MAP['it'])

    try:
        asyncio.run(synthesize(text, output_file, voice))
        print(f"✓ Generated: {output_file} (voice={voice})", file=sys.stderr)
    except Exception as e:
        print(f"✗ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
