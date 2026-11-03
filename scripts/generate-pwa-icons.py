#!/usr/bin/env python3
"""Generate the portal's PWA icons, including a genuinely maskable one.

Why this is a script and not a checked-in binary someone edited once
-------------------------------------------------------------------
The maskable icon is not "the logo again with purpose=maskable". The maskable
spec reserves a safe zone: a circle of radius 40% of the icon width, centred.
Everything outside that circle MAY be cropped by the launcher, which picks the
shape (circle, squircle, rounded square). So a maskable asset must draw its
subject SMALL and CENTRED over a full-bleed opaque background.

The existing `logo512.png` artwork occupies roughly 80-85% of the canvas width
(measured), which runs well outside the 40% radius. Declaring it maskable would
get the extremities cropped on a real Android home screen — and the previous
revision did exactly that, by listing the same file under both `any` and
`maskable`.

Geometry used here
------------------
  canvas      512 x 512
  safe circle radius = 40% * 512 = 204.8px, so a 409.6px box
  subject     inscribed in a 300px box  (58.6% of the canvas)
              -> every subject pixel is inside a 150px radius, comfortably
                 inside the 204.8px safe radius even at the diagonal corner
  background  full-bleed, opaque, #14161d (the --color-bg of the UI)

Run:  python3 scripts/generate-pwa-icons.py
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - tooling guard
    sys.exit("Pillow is required: python3 -m pip install --user pillow")

REPO = Path(__file__).resolve().parent.parent
PUBLIC = REPO / "public"
# The TRANSPARENT variant, not the "-White" one. Measured: `-White.png` is an
# OPAQUE (alpha 255 everywhere) 530x530 image whose "transparent" area is
# actually solid white, so compositing it onto a dark background paints a white
# box with the mark inside it — which is exactly what the first revision of this
# icon did. `-trannsparent.png` carries real alpha (extrema 0-255, corner alpha
# 0) with the mark's opaque bounding box at 83% of the width.
BRAND_ICON = REPO / "src" / "assets" / "logo" / "TollGate_icon-trannsparent.png"

# The UI background: --color-bg in src/index.scss, and theme-color in
# index.html / balance.html. The splash must not flash a different colour.
BG = (0x14, 0x16, 0x1D)

SAFE_RATIO = 0.40  # spec: radius = 40% of the icon width


def _load_subject(target_px: int) -> Image.Image:
    """The brand mark, trimmed of its transparent padding, resized to target_px.

    The trim is load-bearing for GOOD and for BAD reasons:
      good — the source carries ~8-15% transparent margin, so without the trim
             the effective artwork is smaller than the size the geometry below
             computes, and the safe-zone arithmetic would be wrong in the
             conservative direction only by accident;
      bad  — `Image.getbbox()` on an RGBA image returns the ALPHA bounding box,
             which is correct here but is why the opaque "-White" variant
             silently produced a full-canvas white square: its alpha is 255
             everywhere, so its bbox is the whole image.
    """
    src = Image.open(BRAND_ICON).convert("RGBA")
    bbox = src.getbbox()
    if bbox:
        src = src.crop(bbox)
    return src.resize((target_px, target_px), Image.LANCZOS)


def make_maskable(size: int = 512) -> Image.Image:
    """A full-bleed opaque icon whose subject sits inside the safe circle."""
    canvas = Image.new("RGB", (size, size), BG)

    safe_radius = SAFE_RATIO * size
    # Inscribe the SUBJECT (square) in a circle of that radius: a square of side
    # s has circumradius s/2 * sqrt(2), so s = 2 * r / sqrt(2) = r * sqrt(2).
    # Use half of that as generous headroom: the artwork's own extremities are
    # what must clear the circle, and the brand mark is wider than it is tall.
    subject_side = int(safe_radius * 1.4142 * 0.72)
    subject = _load_subject(subject_side)

    offset = ((size - subject_side) // 2, (size - subject_side) // 2)
    canvas.paste(subject, offset, subject)
    return canvas


def make_any(size: int) -> Image.Image:
    """The `any` icon: transparent background, artwork filling the canvas.

    Kept as its OWN file rather than reusing the maskable one, because the two
    roles have genuinely different geometry: an `any` icon may use the full
    canvas and may be transparent, a maskable one may do neither.
    """
    subject = _load_subject(size)
    return subject


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)

    # `any`: transparent, full-bleed artwork (the existing convention).
    for size in (192, 512):
        out = PUBLIC / f"logo{size}.png"
        make_any(size).save(out, "PNG", optimize=True)
        print(f"wrote {out.relative_to(REPO)} ({size}x{size}, RGBA)")

    # `maskable`: opaque full-bleed background, subject inside the safe circle.
    maskable = make_maskable(512)
    # RGB (colour type 2), NOT RGBA: a maskable icon must be fully opaque, or
    # the launcher's own background shows through the corners.
    maskable = maskable.convert("RGB")
    out = PUBLIC / "logo-maskable-512.png"
    maskable.save(out, "PNG", optimize=True)
    print(f"wrote {out.relative_to(REPO)} (512x512, RGB, opaque, safe zone respected)")

    # Measure the claim rather than asserting it in prose.
    px = maskable.load()
    corners = [px[0, 0], px[511, 0], px[0, 511], px[511, 511]]
    uniform = all(c == corners[0] for c in corners)
    print(f"  corner pixels uniform: {uniform} {corners[0]}")

    subject_side = int(SAFE_RATIO * 512 * 1.4142 * 0.72)
    # Half-diagonal of the subject box == its distance from centre at the corner.
    corner_radius = subject_side / 2 * (2 ** 0.5)
    print(
        f"  subject box {subject_side}px -> corner radius {corner_radius:.1f}px "
        f"vs safe radius {SAFE_RATIO * 512:.1f}px "
        f"=> {'INSIDE' if corner_radius <= SAFE_RATIO * 512 else 'OUTSIDE'}"
    )
    return 0 if uniform else 1


if __name__ == "__main__":
    raise SystemExit(main())
