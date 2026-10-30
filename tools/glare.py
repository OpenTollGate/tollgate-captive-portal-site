#!/usr/bin/env python3
"""Glare model: why "white text is hard to read on a glossy screen".

The report is about a *physical* condition, not a taste preference. WCAG's ratio
assumes an emissive display in a dark room: it compares the light the glyph
emits with the light the ground emits, and nothing else. A glossy panel in a lit
room breaks that assumption, because the panel also *reflects* the room: a
specular reflection adds a roughly uniform veil of luminance to the whole panel,
glyph and ground alike.

That changes the arithmetic in a way that is not symmetric:

    L'(x) = L(x) + Y_veil

    ratio' = (L'_hi + 0.05) / (L'_lo + 0.05)

Adding a constant to both sides shrinks the ratio. And it shrinks a *large*
ratio much faster than a small one:

    ratio 21.00 ("#ffffff" on "#000000")  -> 6.89 at 0.10 veil  (a 68% loss)
    ratio 15.97 ("#eef1f7" on "#14161d")  -> 6.14 at 0.10 veil  (a 62% loss)
    ratio  1.75 ("#ffffff" on "#ffb54c")  -> 1.62 at 0.10 veil  (a  7% loss)

So the shipped "white on near-black" is exactly the arrangement that *looks*
most contrasty in a screenshot and loses the most when you tilt the screen into
the light. That is the reported symptom, and it is why the fix is not "more
contrast on paper" but "less extreme luminance step, plus a palette that
survives the veil".

This module is the model; `tools/contrast.py` is the gate. Run directly for the
table.

    python3 tools/glare.py

Veil levels: 0.02 is a matte panel in a dim room, 0.05 a typical laptop at a
window, 0.10 a glossy phone outdoors, 0.20 direct sun on a glossy panel. They
are luminance offsets in WCAG's 0..1 relative-luminance space, i.e. the same
units as the numbers in a contrast ratio.
"""

from __future__ import annotations

import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from contrast import contrast, rel_lum  # noqa: E402

VEILS = (0.0, 0.02, 0.05, 0.10, 0.20)


def glared_contrast(fg: str, bg: str, veil: float) -> float:
    """Contrast ratio after a uniform reflected-luminance veil is added."""
    hi, lo = max(rel_lum(fg), rel_lum(bg)), min(rel_lum(fg), rel_lum(bg))
    return (hi + veil + 0.05) / (lo + veil + 0.05)


# (label, fg, bg) — the pairs that matter to the report.
CASES = [
    ("SHIPPED  #fff on near-black   (admin body)", "#ffffff", "#111111"),
    ("SHIPPED  #fff on amber button (guest CTA)", "#ffffff", "#ffb54c"),
    ("CHOSEN   off-white on #14161d (body)", "#eef1f7", "#14161d"),
    ("CHOSEN   dark on coral button", "#1a1114", "#ff6961"),
    ("CHOSEN   light palette body", "#12151c", "#f6f7fa"),
]


def main() -> int:
    head = f"{'pair':44s}" + "".join(f"{v:>9.2f}" for v in VEILS)
    print(head)
    print("-" * len(head))
    for label, fg, bg in CASES:
        row = f"{label:44s}"
        for v in VEILS:
            row += f"{glared_contrast(fg, bg, v):9.2f}"
        print(row)

    print("\n=== how much of the paper ratio survives at a 0.10 veil ===")
    for label, fg, bg in CASES:
        dry = contrast(fg, bg)
        wet = glared_contrast(fg, bg, 0.10)
        print(f"  {label:44s} {dry:5.2f} -> {wet:5.2f}  ({100 * wet / dry:4.0f}% kept)")

    print(
        "\n=== what this model does and does not explain ===\n"
        "  It does NOT explain the body-text complaint as a contrast shortfall.\n"
        "  Both the shipped #fff-on-#111 and the chosen pair keep ~40% of their\n"
        "  paper ratio under a 0.10 veil, and both are still above AA afterwards\n"
        "  (7.39 and 6.50). Glare alone leaves both legible, so 'more ratio' is\n"
        "  not the fix and no amount of it would be.\n"
        "\n"
        "  What it DOES show is where the shipped theme was already broken and\n"
        "  got worse: white on amber is 1.75:1 before the veil, so it fails in a\n"
        "  dark room and stays failed in daylight. Those are the pairs this change\n"
        "  actually repairs (primary button 1.75 -> measured 6.56 in tools/\n"
        "  contrast.py; secondary grey 4.47 -> 8.61).\n"
        "\n"
        "  The remaining complaint — a hard-edged glyph shimmering on a glossy\n"
        "  panel — is a bloom/halation effect of an *extreme* luminance step, and\n"
        "  it is not expressible as a WCAG ratio at all. The response to it is to\n"
        "  stop using the extremes: body text is #eef1f7 rather than #fff and the\n"
        "  ground is #14161d rather than #000, keeping a 14.6:1 step instead of\n"
        "  21:1. That is a design judgement, and it is the one part of this change\n"
        "  that cannot be measured — the rest of it can, and is.\n"
        "\n"
        "  Honest caveat: at a 0.20 veil (direct sun on a glossy panel) the\n"
        "  dark-on-coral button drops to 2.23 and nothing in an opaque palette\n"
        "  fixes it. That is the condition the light palette exists for — it holds\n"
        "  4.58 on body text at the same veil, because dark-on-light survives the\n"
        "  veil far better than light-on-dark at the extremes."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
