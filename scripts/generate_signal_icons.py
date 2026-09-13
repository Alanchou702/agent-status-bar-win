"""Generate crisp multi-resolution Windows icons matching the shared status palette.
Run with Python + Pillow; checked-in ICO files are sufficient for normal builds.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUTPUT = Path(__file__).resolve().parents[1] / 'resources'
COLORS = {'idle': '#83909f', 'blue': '#4275d5', 'green': '#22926c', 'red': '#d04b52', 'yellow': '#bd831c'}
SIZES = [(n, n) for n in (16, 20, 24, 32, 48, 64, 128, 256)]
ALIASES = {'running': 'blue', 'busy': 'green', 'approval': 'red'}
for name, color in {**COLORS, **{name: COLORS[state] for name, state in ALIASES.items()}}.items():
    image = Image.new('RGBA', (256, 256))
    draw = ImageDraw.Draw(image)
    draw.ellipse((29, 29, 227, 227), fill=color, outline=(255, 255, 255, 225), width=12)
    image.save(OUTPUT / f'tray-{name}.ico', sizes=SIZES)

image = Image.new('RGBA', (256, 256))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 8, 248, 248), radius=52, fill='#f8faff', outline='#cbd5e2', width=5)
for bounds, color in [((55, 101, 85, 173), '#4275d5'), ((110, 59, 140, 197), '#4275d5'), ((165, 86, 195, 181), '#22926c')]:
    draw.rounded_rectangle(bounds, radius=15, fill=color)
image.save(OUTPUT / 'app-icon.ico', sizes=SIZES)
