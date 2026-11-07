# Иконка Nyao Music Red: три волны (жёлтая, лавандовая, коралловая) → красные оттенки; фон и персонаж не трогаем.
# Красные копии лежат в build/red/ и android/app/src/red/; пересобрать после смены иконки:
#   python3 scripts/red-icon.py build/icon.png build/red/icon.png
#   python3 scripts/red-icon.py build/icon-mac.png build/red/icon-mac.png
#   python3 scripts/red-icon.py ios/NyaoMusic/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png build/red/ios-icon-1024.png
#   python3 scripts/red-icon.py android/app/src/main/res/drawable-nodpi/ic_launcher_art.png android/app/src/red/res/drawable-nodpi/ic_launcher_art.png
import sys, colorsys
from PIL import Image

BASE = {'yellow': (240, 208, 0), 'lav': (208, 192, 240), 'coral': (240, 80, 64)}
TARGET = {'yellow': (255, 92, 92), 'lav': (255, 168, 168), 'coral': (178, 18, 30)}

def kind(r, g, b):
    if max(r, g, b) < 25: return None
    h, s, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if s > 0.45 and 0.10 <= h <= 0.20: return 'yellow'
    if s > 0.35 and (h >= 0.97 or h <= 0.05): return 'coral'
    if 0.08 <= s <= 0.45 and 0.66 <= h <= 0.80: return 'lav'
    return None

def waves_box(im):
    """Рамка волн: жёлтые и коралловые пиксели в левой части картинки (персонаж — справа) плюс 3% запаса"""
    w, h = im.size; px = im.load(); xs = []; ys = []
    for y in range(h):
        for x in range(int(w * 0.62)):
            r, g, b, a = px[x, y]
            if a > 200 and ((r > 200 and g > 170 and b < 60) or (r > 200 and 50 < g < 110 and b < 90)): xs.append(x); ys.append(y)
    p = int(w * 0.03)
    return max(0, min(xs) - p), max(0, min(ys) - p), min(w, max(xs) + p), min(h, max(ys) + p)

im = Image.open(sys.argv[1]).convert('RGBA'); px = im.load()
x0, y0, x1, y1 = waves_box(im)
for y in range(y0, y1):
    for x in range(x0, x1):
        r, g, b, a = px[x, y]
        k = kind(r, g, b)
        if not k: continue
        f = max(r, g, b) / max(BASE[k]); t = TARGET[k]
        px[x, y] = (min(255, int(t[0] * f)), min(255, int(t[1] * f)), min(255, int(t[2] * f)), a)
im.save(sys.argv[2])
