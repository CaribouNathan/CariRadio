# Icône d'app CariRadio 1024 px (gabarit macOS : carré arrondi 824 px centré, ombre portée).
from PIL import Image, ImageDraw, ImageFilter
import math, sys
S = 1024 * 2
im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
box = int(S * 824 / 1024); off = (S - box) // 2; rad = int(box * 0.225)
# ombre
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(sh)
d.rounded_rectangle([off, off + S * 0.012, off + box, off + box + S * 0.012], rad, fill=(0, 0, 0, 90))
im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(S * 0.012)))
# fond : dégradé chocolat
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
top, bot = (150, 88, 52), (52, 26, 14)
for y in range(S):
    t = min(1, max(0, (y - off) / box))
    gd.line([(0, y), (S, y)], fill=tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3)) + (255,))
mask = Image.new("L", (S, S), 0); ImageDraw.Draw(mask).rounded_rectangle([off, off, off + box, off + box], rad, fill=255)
im.paste(grad, (0, 0), mask)
# ondes radio
d = ImageDraw.Draw(im)
cx, cy = S / 2, S * 0.53
col = (255, 246, 236, 255)
w = int(S * 0.034)
for r, span in ((S * 0.13, 50), (S * 0.22, 48), (S * 0.31, 46)):
    for a0 in (180 - span, -span):
        d.arc([cx - r, cy - r, cx + r, cy + r], a0, a0 + 2 * span, fill=col, width=w)
    # extrémités arrondies
    for a in (180 - span, 180 + span, -span, span):
        x, y = cx + (r - w / 2) * math.cos(math.radians(a)), cy + (r - w / 2) * math.sin(math.radians(a))
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)
rr = S * 0.058
d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col)
# pied d'antenne
d.polygon([(cx - S * 0.02, cy + rr * 0.6), (cx + S * 0.02, cy + rr * 0.6), (cx + S * 0.075, S * 0.80), (cx - S * 0.075, S * 0.80)], fill=col)
im.resize((1024, 1024), Image.LANCZOS).save(sys.argv[1])
print("ok")
