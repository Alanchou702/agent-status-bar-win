from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[1] / 'resources'
COLORS = {'red': (240, 68, 67, 255), 'yellow': (248, 189, 53, 255), 'green': (46, 210, 106, 255)}
STATES = {'tray-idle.ico': 'green', 'tray-running.ico': 'green', 'tray-busy.ico': 'green', 'tray-approval.ico': 'red'}

for filename, active in STATES.items():
    images = []
    for size in (16, 24, 32, 48, 64, 128, 256):
        scale = size / 64
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for i, key in enumerate(('red', 'yellow', 'green')):
            if key == active:
                cx = int((18 + i * 14) * scale)
                cy = int(32 * scale)
                r = int(8 * scale)
                c = COLORS[key]
                gd.ellipse((cx-r*2, cy-r*2, cx+r*2, cy+r*2), fill=(*c[:3], 115))
        glow = glow.filter(ImageFilter.GaussianBlur(max(1, int(4 * scale))))
        img.alpha_composite(glow)
        d = ImageDraw.Draw(img)
        radius = int(15 * scale)
        d.rounded_rectangle((int(2*scale), int(6*scale), int(62*scale), int(58*scale)), radius=radius, fill=(20, 26, 31, 245), outline=(180, 195, 198, 190), width=max(1, int(scale)))
        for i, key in enumerate(('red', 'yellow', 'green')):
            cx = int((18 + i * 14) * scale)
            cy = int(32 * scale)
            r = int(6 * scale)
            d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=COLORS[key] if key == active else (55, 65, 70, 255), outline=(225, 235, 235, 215), width=max(1, int(scale)))
            if key == active:
                d.ellipse((cx-int(2*scale), cy-int(3*scale), cx+int(1*scale), cy), fill=(255,255,255,120))
        images.append(img)
    images[0].save(OUT / filename, format='ICO', sizes=[(im.width, im.height) for im in images], append_images=images[1:])
