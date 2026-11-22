"""Probe the alpha channel of the brand mark candidates.

Written as a file rather than a `python3 -c` one-liner because this session
cannot run inline interpreter scripts. Prints, per candidate: mode, size, the
alpha range, and the alpha at the four corners plus the centre — which is what
distinguishes "transparent artwork" from "artwork on an opaque box".
"""
from PIL import Image
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CANDIDATES = [
    "src/assets/logo/TollGate_icon-White.png",
    "src/assets/logo/TollGate_icon-trannsparent.png",
    "src/assets/logo/TollGate_icon-Black.png",
    "src/assets/logo/TollGate_logo-C-white.png",
    "src/assets/logo/TollGate_logo-C-black.png",
    "public/logo512.png",
    "public/logo-maskable-512.png",
]

for rel in CANDIDATES:
    p = REPO / rel
    if not p.exists():
        print(f"{rel}: MISSING")
        continue
    im = Image.open(p)
    print(f"{rel}: mode={im.mode} size={im.size}")
    if im.mode == "RGBA":
        a = im.getchannel("A")
        w, h = im.size
        corners = [im.getpixel((0, 0))[3], im.getpixel((w - 1, 0))[3],
                   im.getpixel((0, h - 1))[3], im.getpixel((w - 1, h - 1))[3]]
        print(f"   alpha extrema={a.getextrema()} corners={corners} centre_alpha={im.getpixel((w // 2, h // 2))[3]}")
        bbox = im.getbbox()
        if bbox:
            bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
            print(f"   opaque bbox={bbox} => subject {bw}x{bh} = {bw / w:.0%} of width")
    else:
        print(f"   (no alpha channel; corner pixel={im.getpixel((0, 0))})")
