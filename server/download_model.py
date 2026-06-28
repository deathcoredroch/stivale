#!/usr/bin/env python3
import os
from pathlib import Path

# Создать директорию для моделей
model_dir = Path.home() / ".local" / "share" / "piper"
model_dir.mkdir(parents=True, exist_ok=True)

print(f"Downloading model to: {model_dir}")

# Пытаемся загрузить модель
try:
    from piper.voice import PiperVoice

    voice_name = "it_IT/riccardo_gione"
    print(f"Loading voice: {voice_name}")

    # Это автоматически загрузит модель если её нет
    voice = PiperVoice.load(voice_name)
    print(f"✓ Voice loaded successfully: {voice_name}")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
