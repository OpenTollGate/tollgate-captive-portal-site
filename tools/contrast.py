#!/usr/bin/env python3
"""WCAG 2.1 contrast gate for the TollGate theme.

The report behind this change is "the white colour is hard to read on a glossy
screen", so the fix is measured rather than eyeballed. This is the only copy of
the arithmetic the theme uses: WCAG 2.1 relative luminance applied to the token
pairs both UIs actually paint.

It is a *gate*, not a report. It parses the token values out of the shipped
stylesheets —

    admin/src/styles/variables.css   (admin board)
    src/index.scss                   (guest portal + balance page)

— so it cannot drift from what the build emits, resolves `var()` aliases the way
the cascade does, and exits non-zero if any gated pair drops below its
threshold. `--json` for machine consumption.

Thresholds (WCAG 2.1):
  4.5:1  1.4.3 normal body text (AA)
  3.0:1  1.4.3 large text >= 24px / >= 18.66px bold, and 1.4.11 non-text UI
         (control borders, focus rings, state indicators)
  measured-only  decorative separators: 1.4.11 does not apply to a hairline that
         carries no state, so those rows are reported without a gate. Naming
         them that way is the point — an unlabelled 1.3:1 row that silently
         passes is how a theme rots.

WHAT THIS FILE STRUCTURALLY CANNOT SEE: `opacity`.

Every row above scores two token VALUES. `opacity` is not a value — it is a
multiply applied at paint time, so a rule can pair two passing tokens and still
emit a failing pair:

    color: var(--text-dim);   /* 6.29:1 on --bg — passes */
    opacity: 0.8;             /* painted #767f90 on the page = 4.47:1 */

That is not hypothetical: it is how `.btn:disabled`, `.ui-crosslink`,
`.ui-crosslink-reason`, the guest placeholder, the guest `.cancel` button and
the whole guest button base all shipped below AA while this file said 0
failures. The fix each time is the same — express the de-emphasis as a COLOUR
token instead — so the class is also gated structurally, by
tools/check-no-text-opacity.py, which fails if a rule that sets a text colour
also multiplies it by opacity. A pair list alone will always be one rule
behind; the structural check is what makes the class unrepeatable.

Run: python3 tools/contrast.py [--json] [--before]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── WCAG 2.1 arithmetic ────────────────────────────────────────────────


def srgb_to_lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def parse_hex(hexstr: str) -> tuple[float, float, float]:
    h = hexstr.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def rel_lum(hexstr: str) -> float:
    r, g, b = parse_hex(hexstr)
    return 0.2126 * srgb_to_lin(r) + 0.7152 * srgb_to_lin(g) + 0.0722 * srgb_to_lin(b)


def contrast(a: str, b: str) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def blend(fg: str, bg: str, alpha: float) -> str:
    """Composite `fg` at `alpha` over opaque `bg` -> the #rrggbb a screen shows.

    The shipped theme uses translucent tokens for secondary text
    (`rgba(255,255,255,0.45)`), so the audit has to score the *composited*
    colour, not the token's nominal one, or it over-reports its own legibility.
    """
    fr, fg_, fb = parse_hex(fg)
    br, bg_, bb = parse_hex(bg)
    out = [
        round((f * alpha + b * (1 - alpha)) * 255) for f, b in ((fr, br), (fg_, bg_), (fb, bb))
    ]
    return "#{:02x}{:02x}{:02x}".format(*out)


# ── token extraction (reads the shipped stylesheets) ───────────────────

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
DECL_RE = re.compile(r"(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);")
LIGHT_BLOCK_RE = re.compile(r"@media\s*\(prefers-color-scheme:\s*light\)\s*\{", re.I)


def _balanced(text: str, open_idx: int) -> str:
    """Return the body of the block whose `{` is at `open_idx`."""
    depth = 0
    for i in range(open_idx, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1 : i]
    raise ValueError("unbalanced braces")


def parse_tokens(path: Path) -> dict[str, dict[str, str]]:
    """Split a stylesheet's custom properties into (dark, light) token maps.

    Everything at the top level (and inside any non-colour-scheme `@media`, such
    as `prefers-contrast: more`) is the default palette; a token the
    `prefers-color-scheme: light` block sets wins in that scheme, and one it
    omits inherits the default — exactly what the cascade does.

    Blocks that exist to *firm up* the default (the `prefers-contrast` override
    aliasing --border to the control border) are deliberately NOT folded into
    the default: they describe a different user setting, and folding them in
    would make this audit score a palette nobody sees by default.
    """
    raw = COMMENT_RE.sub("", path.read_text())
    light_ranges: list[tuple[int, int]] = []
    other_media: list[tuple[int, int]] = []
    for m in re.finditer(r"@media([^{]*)\{", raw):
        cond = m.group(1)
        body = _balanced(raw, m.end() - 1)
        start, end = m.end(), m.end() + len(body)
        if LIGHT_BLOCK_RE.search("@media" + cond + "{"):
            light_ranges.append((start, end))
        else:
            other_media.append((start, end))

    base, light = {}, {}
    for m in DECL_RE.finditer(raw):
        name, value = m.group(1), " ".join(m.group(2).split())
        if any(a <= m.start() < b for a, b in other_media):
            continue
        in_light = any(a <= m.start() < b for a, b in light_ranges)
        (light if in_light else base)[name] = value
    resolved = {**base, **light}
    return {"dark": base, "light": resolved}


VAR_RE = re.compile(r"^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*(.+))?\)$")


def resolve(tokens: dict[str, str], value: str, _depth: int = 0) -> str:
    """Follow `var(--alias)` chains to a concrete value (cascade-equivalent)."""
    v = value.strip()
    m = VAR_RE.match(v)
    if not m:
        return v
    name, fallback = m.group(1), m.group(2)
    if _depth > 16:
        raise ValueError(f"var() cycle at {name}")
    if name in tokens:
        return resolve(tokens, tokens[name], _depth + 1)
    if fallback is not None:
        return resolve(tokens, fallback, _depth + 1)
    raise KeyError(f"{name} is used but never defined")


HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
RGBA_RE = re.compile(r"^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$")


def to_hex(value: str) -> str:
    if HEX_RE.match(value):
        return value.lower()
    m = RGBA_RE.match(value)
    if m:
        r, g, b = (int(float(m.group(i))) for i in (1, 2, 3))
        return "#{:02x}{:02x}{:02x}".format(r, g, b)
    raise ValueError(f"not a colour: {value!r}")


def colour(tokens: dict[str, str], name: str, over: str | None = None) -> str:
    """Resolve a token to the #rrggbb a screen shows, compositing alpha over `over`."""
    value = resolve(tokens, tokens[name])
    m = RGBA_RE.match(value)
    if m and (m.group(4) is None or float(m.group(4)) < 1.0):
        alpha = 1.0 if m.group(4) is None else float(m.group(4))
        ground = colour(tokens, over) if over else "#000000"
        return blend(to_hex(value[: value.index(")") + 1]), ground, alpha)
    return to_hex(value)


# ── the pairs, per palette ─────────────────────────────────────────────
#
# Entry: (label, fg token, bg token, threshold, composite-over or None)
# threshold 0.0 == measured-only (reported, not gated) with a stated reason.

GUEST = "guest"
ADMIN = "admin"

PAIRS: dict[str, list[tuple]] = {
    GUEST: [
        ("body text on page", "text", "bg", 4.5, None),
        ("body text on card", "text", "surface", 4.5, None),
        ("body text on raised panel", "text", "raised", 4.5, None),
        ("secondary text on card", "muted", "surface", 4.5, None),
        ("dim text on page", "dim", "bg", 4.5, None),
        ("accent text on page", "accent", "bg", 4.5, None),
        ("accent text on card", "accent", "surface", 4.5, None),
        ("PRIMARY BUTTON label", "on-accent", "accent", 4.5, None),
        # the balance header is a filled success ground, label sits on the fill
        ("balance-header label", "on-success", "success", 4.5, None),
        ("success text on success tint", "success", "success-dim", 4.5, "surface"),
        ("error text on error tint", "error", "error-dim", 4.5, "surface"),
        # a filled chip: its own ground, page colour as label
        ("chip label", "bg", "chip", 4.5, None),
        ("UI control border on card", "border-control", "surface", 3.0, None),
        ("UI control border on page", "border-control", "bg", 3.0, None),
        # Disabled controls are exempt from 1.4.3, but the disabled state is
        # what a form OPENS in (Sign In is disabled until a password is typed),
        # so it is the state the "hard to read" report is about. Gate it at AA
        # anyway: opacity-based disabling composited this pair to ~2.3:1.
        ("disabled button label", "disabled-text", "disabled-bg", 4.5, None),
        # The ghost CTA paints the ACCENT AS TEXT on a tint of that same accent.
        # That is a text pair on a ground the tint makes lighter/darker than the
        # page, and it was the one painted pair nothing scored: at the old .16
        # tint the light accent held 4.15:1 on a raised surface, under AA.
        ("ghost CTA accent text on own tint (card)", "accent", "accent-dim", 4.5, "surface"),
        ("ghost CTA accent text on own tint (raised)", "accent", "accent-dim", 4.5, "raised"),
        # A placeholder is text the user reads to know what to type, and it sits
        # on the field ground. It used to be body colour x opacity .6 = 2.94:1.
        ("placeholder text on field", "dim", "surface", 4.5, None),
        # WCAG 2.4.11: the focus indicator must differ from the control's
        # RESTING state by >= 3:1. A border swap border-control -> accent is
        # 1.63:1 dark / 1.36:1 light, so the ring token is what carries it.
        ("focus ring vs resting control border", "focus-ring", "border-control", 3.0, None),
        ("focus ring vs page", "focus-ring", "bg", 3.0, None),
        # QR: modules are pure black, the ground must stay light in BOTH palettes
        ("QR modules on QR ground", "qr-ink", "qr-ground", 4.5, None),
        # decorative hairline, no state -> no gate (see module docstring)
        ("card border on page (decorative)", "border", "bg", 0.0, None),
    ],
    ADMIN: [
        ("body text on page", "text", "bg", 4.5, None),
        ("body text on card", "text", "surface", 4.5, None),
        ("body text on raised panel", "text", "raised", 4.5, None),
        ("secondary text on page", "muted", "bg", 4.5, None),
        ("secondary text on card", "muted", "surface", 4.5, None),
        ("dim text on card", "dim", "surface", 4.5, None),
        ("accent text on page", "accent", "bg", 4.5, None),
        ("accent text on card", "accent", "surface", 4.5, None),
        ("PRIMARY BUTTON label", "on-accent", "accent", 4.5, None),
        ("danger button label", "on-accent", "error", 4.5, None),
        # The HOVER fill is a separate pair and was untested: hover swapped to
        # --error-strong (a dark red) while the label stayed --text-on-accent
        # (dark in this palette), landing at 3.39:1 — below AA, and worse than
        # the rest state. Gated so the hover fill cannot drift from its label.
        ("danger button label on HOVER fill", "on-accent", "error-hover", 4.5, None),
        ("secondary button label", "text", "raised", 4.5, None),
        ("success badge text", "success", "success-dim", 4.5, "surface"),
        ("error badge text", "error", "error-dim", 4.5, "surface"),
        ("accent badge text", "accent", "accent-dim", 4.5, "surface"),
        ("UI control border on card", "border-control", "surface", 3.0, None),
        ("UI control border on page", "border-control", "bg", 3.0, None),
        # The cross-link and its reason line are --text-dim text that used to be
        # multiplied by opacity .8 / .7. The opacity composited them UNDER AA
        # (4.47:1 and 3.72:1 dark, 3.55:1 and 2.93:1 light) while --text-dim on
        # its own is fine — the classic gate-cannot-see-opacity failure.
        ("cross-link text on header", "dim", "header", 4.5, "bg"),
        ("cross-link text on raised panel", "dim", "raised", 4.5, None),
        # WCAG 2.4.11, see the guest block: the ring must clear 3:1 against the
        # RESTING border it replaces, not just against the page.
        ("focus ring vs resting control border", "focus-ring", "border-control", 3.0, None),
        ("focus ring vs page", "focus-ring", "bg", 3.0, None),
        # see the guest block: disabled is the state a form opens in
        ("disabled button label", "disabled-text", "disabled-bg", 4.5, None),
        ("card border on page (decorative)", "border", "bg", 0.0, None),
    ],
}

# Which stylesheet defines each UI's palette, and the same conceptual token
# under each file's own name. The names differ because the guest SCSS predates
# the admin tokens; one *palette*, two vocabularies (see index.scss header).
SOURCES = {
    GUEST: (ROOT / "src/index.scss", {
        "bg": "--color-bg", "surface": "--color-surface", "raised": "--color-surface-raised",
        "text": "--color", "muted": "--color-negative", "dim": "--color-dim",
        "accent": "--color-cta", "on-accent": "--color-on-accent",
        "accent-dim": "--color-cta-transparent", "focus-ring": "--color-focus-ring",
        "success": "--color-green", "success-dim": "--color-green-transparent",
        "error": "--color-red", "error-dim": "--color-red-transparent",
        "on-success": "--color-on-success", "chip": "--color-chip",
        "border": "--color-border", "border-control": "--color-border-control",
        "qr-ground": "--color-qr-ground", "qr-ink": "--color-qr-ink",
        "disabled-bg": "--color-disabled-bg", "disabled-text": "--color-disabled-text",
    }),
    ADMIN: (ROOT / "admin/src/styles/variables.css", {
        "bg": "--bg", "surface": "--card", "raised": "--card-hover",
        # the header/nav ground is a translucent scrim over the page, so a pair
        # "on header" composites it over --bg rather than treating it as opaque
        "header": "--scrim",
        "text": "--text", "muted": "--text-muted", "dim": "--text-dim",
        "accent": "--accent", "on-accent": "--text-on-accent",
        "accent-dim": "--accent-dim", "focus-ring": "--focus-ring",
        "success": "--success", "success-dim": "--success-dim",
        "error": "--error", "error-hover": "--error-hover", "error-dim": "--error-dim",
        "border": "--border", "border-control": "--border-control",
        "disabled-bg": "--disabled-bg", "disabled-text": "--disabled-text",
    }),
}


def audit(ui: str, scheme: str) -> list[dict]:
    path, names = SOURCES[ui]
    tokens = parse_tokens(path)[scheme]
    rows = []
    for label, fg, bg, need, over in PAIRS[ui]:
        fg_hex = colour(tokens, names[fg], names[over] if over else None)
        bg_hex = colour(tokens, names[bg], names[over] if over else None)
        ratio = contrast(fg_hex, bg_hex)
        rows.append({
            "pair": label, "fg": fg_hex, "bg": bg_hex,
            "ratio": round(ratio, 2), "required": need,
            "gated": need > 0, "pass": (ratio >= need) if need > 0 else True,
        })
    return rows


# ── the "before" palettes, for the report ──────────────────────────────
#
# Read out of the stylesheets at the merge-base of this change. They are here so
# the audit states the before-number rather than asserting one.

BEFORE: dict[str, dict[str, str]] = {
    "admin (before)": {
        "bg": "#111111", "surface": "#1a1a1a", "raised": "#222222", "border": "#2a2a2a",
        "text": "#ffffff", "muted": blend("#ffffff", "#1a1a1a", 0.45),
        "dim": blend("#ffffff", "#1a1a1a", 0.25), "accent": "#ff6600", "on-accent": "#ffffff",
        "success": "#32d74b", "error": "#ff453a",
    },
    "guest (before)": {
        "bg": "#080e1d", "surface": blend("#ffffff", "#080e1d", 0.9), "raised": "#ffffff",
        "border": "#dbdbdb", "text": "#171d35", "muted": "#959cb1", "dim": "#b9b9b9",
        "accent": "#ffb54c", "on-accent": "#ffffff", "success": "#4aa922", "error": "#c32222",
    },
}

BEFORE_PAIRS = [
    ("body text on card", "text", "surface", 4.5),
    ("secondary text on card", "muted", "surface", 4.5),
    ("dim text on card", "dim", "surface", 4.5),
    ("accent text on card", "accent", "surface", 4.5),
    ("PRIMARY BUTTON label", "on-accent", "accent", 4.5),
    ("success text on card", "success", "surface", 4.5),
]


def before_table() -> str:
    out = []
    for name, pal in BEFORE.items():
        out.append(f"\n=== {name} ===")
        for label, fg, bg, need in BEFORE_PAIRS:
            r = contrast(pal[fg], pal[bg])
            out.append(
                f"  {label:34s} {pal[fg]} on {pal[bg]}  {r:5.2f}:1  "
                f"(need {need:.1f})  {'PASS' if r >= need else 'FAIL'}"
            )
    return "\n".join(out)


# ── the brand wordmark ──────────────────────────────────────────────────
#
# The wordmark is an IMAGE, so it is the one pair the token layer cannot
# govern: the mark's ink is baked into the PNG. Both admin and guest paint a
# wordmark over the page ground, and the descriptor ships one of each ink
# (`logo-colour.png` = #090909, `logo-white.png` = #ffffff). Selecting the
# wrong one is exactly how the shipped board ended up painting a #090909
# wordmark on the #14161d page — 1.10:1, invisible — so it is gated here.
#
# Inks read from the PNGs (alpha>200 pixels in the wordmark region):
MARKS = {"mark-ink": "#090909", "mark-white": "#ffffff"}

# Which ink each palette must select, and over which ground. `admin` and
# `guest` resolve the same way because both UIs now carry one palette and both
# swap the asset on `prefers-color-scheme` (admin: components/brand-logo.tsx,
# guest: <picture> in App.jsx Header).
WORDMARK = {
    "dark": ("mark-white", "bg"),
    "light": ("mark-ink", "bg"),
}


def wordmark_table(schemes: tuple[str, ...] = ("dark", "light")) -> list[dict]:
    """Wordmark ink vs page ground, per UI and palette. Gated at 3:1 (1.4.11)."""
    rows = []
    for ui in (GUEST, ADMIN):
        _, names = SOURCES[ui]
        for scheme in schemes:
            tokens = parse_tokens(SOURCES[ui][0])[scheme]
            mark, ground = WORDMARK[scheme]
            fg_hex = MARKS[mark]
            bg_hex = colour(tokens, names[ground])
            ratio = contrast(fg_hex, bg_hex)
            rows.append({
                "ui": ui, "scheme": scheme, "mark": mark,
                "fg": fg_hex, "bg": bg_hex,
                "ratio": round(ratio, 2), "required": 3.0,
                "gated": True, "pass": ratio >= 3.0,
            })
    return rows


def main(argv: list[str]) -> int:
    gated_fails = 0
    report: dict[str, dict] = {}

    if "--before" in argv:
        print(before_table())

    for ui in (GUEST, ADMIN):
        for scheme in ("dark", "light"):
            rows = audit(ui, scheme)
            fails = [r for r in rows if not r["pass"]]
            gated_fails += len(fails)
            report[f"{ui}-{scheme}"] = {"pairs": rows, "failures": len(fails)}
            if "--json" in argv:
                continue
            print(f"\n=== {ui} / {scheme} ===")
            for r in rows:
                if r["gated"]:
                    verdict = "PASS" if r["pass"] else "FAIL"
                    need = f"(need {r['required']:.1f})"
                else:
                    verdict = "n/a "
                    need = "(decorative, not gated)"
                print(f"  {r['pair']:36s} {r['fg']} on {r['bg']}  {r['ratio']:5.2f}:1  {need:28s} {verdict}")

    marks = wordmark_table()
    mark_fails = [r for r in marks if not r["pass"]]
    gated_fails += len(mark_fails)
    report["wordmark"] = {"pairs": marks, "failures": len(mark_fails)}
    if "--json" not in argv:
        print("\n=== brand wordmark (image ink, not a token) ===")
        for r in marks:
            verdict = "PASS" if r["pass"] else "FAIL"
            print(
                f"  {r['ui'] + '/' + r['scheme']:36s} {r['fg']} on {r['bg']}  "
                f"{r['ratio']:5.2f}:1  (need 3.0)                   {verdict}"
            )

    if "--json" in argv:
        print(json.dumps(report, indent=2))
        return 1 if gated_fails else 0

    print(f"\n=== {gated_fails} gated pair(s) below threshold ===")
    return 1 if gated_fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
