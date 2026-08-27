#!/usr/bin/env python3
"""Из исходного логотипа делает иконки приложения.

Вход:  backend/assets/logo-src.png (квадратный логотип, лучше >=512px)
Выход: backend/assets/icon.ico  — многоразмерная иконка для Windows exe
       backend/assets/icon.png  — 256×256 для окна/прочего
       frontend/public/favicon.png — для вебвью (если нужно)
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
src = ROOT / "backend" / "assets" / "logo-src.png"

img = Image.open(src).convert("RGBA")
# привести к квадрату по меньшей стороне (на случай неквадратного исходника)
side = min(img.size)
left = (img.width - side) // 2
top = (img.height - side) // 2
img = img.crop((left, top, left + side, top + side))

sizes = [16, 24, 32, 48, 64, 128, 256]
(ROOT / "backend" / "assets" / "icon.ico").unlink(missing_ok=True)
img.save(ROOT / "backend" / "assets" / "icon.ico", sizes=[(s, s) for s in sizes])
img.resize((256, 256), Image.LANCZOS).save(ROOT / "backend" / "assets" / "icon.png")
print("icon.ico и icon.png созданы из", src.name)
