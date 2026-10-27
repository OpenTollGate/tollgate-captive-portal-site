#!/usr/bin/env python3
"""Structural guard: a rule that paints TEXT must not also multiply it by `opacity`.

WHY THIS EXISTS
---------------
`tools/contrast.py` scores token VALUES. `opacity` is not a value — it is a
multiply applied at paint time — so a rule can pair two passing tokens and
still emit a failing pair:

    color: var(--text-dim);   /* the gate scores #8e99ad on #14161d = 6.29:1 */
    opacity: 0.8;             /* the screen shows #767f90 = 4.47:1, under AA */

Review round 1 found three of these (`.btn-danger:hover`, `.ui-crosslink`,
`.ui-crosslink-reason`); sweeping for the rest found five more of the identical
shape. Every one had passed the contrast gate, because the gate cannot see a
multiply. The fix each time was the same — express the de-emphasis as a COLOUR
token instead — so the class is gated structurally here.

WHAT IT FLAGS
  A block that sets `opacity` below 1 AND paints text, where "paints text" is:
    - the block declares a text `color`, or
    - an ancestor block declares a text `color` (the value inherits), or
    - the selector is a text pseudo-element (`::placeholder`, `::selection`,
      `::first-line`, `::marker`).

WHAT IT ALLOWS
  opacity: 1                          a no-op; the reset idiom after a base rule
  opacity inside @keyframes            a fade is a transition between states,
                                      not a resting text pair
  opacity on a block painting no text  a dimmed ICON or SURFACE is 1.4.11
                                      (3:1), not 1.4.3, and dimming a non-text
                                      element toward the page is how a disabled
                                      affordance is meant to read

WHAT IT CANNOT SEE
  Colour inherited from `html, body` (this parser does not walk that far), and
  text dimmed only by a distant ancestor. That is why
  docs/ui-mockups/theme/verify-colors.mjs measures PAINTED pixels from the live
  DOM: the three checks are a ladder, not replacements for each other.

Run: python3 tools/check-no-text-opacity.py [--json]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The stylesheets that actually reach a shipped bundle. styles/base.css is
# deliberately absent: nothing imports it (see variables.css header).
SOURCES = [
    ROOT / "admin/src/styles/admin.css",
    *sorted((ROOT / "src").rglob("*.scss")),
]

TEXT_PSEUDO = ("::placeholder", "::selection", "::first-line", "::marker")
COLOR_DECL = re.compile(r"(?:^|[;{}])\s*(?<![\w-])color\s*:\s*([^;{}]+)", re.I)
OPACITY_DECL = re.compile(r"(?:^|[;{}])\s*opacity\s*:\s*([^;{}]+)", re.I)
KEYFRAMES = re.compile(r"^@(?:-webkit-)?keyframes\b", re.I)
PSEUDO_OR_ATTR = re.compile(r"::?[\w-]+(?:\([^)]*\))?|\[[^\]]*\]")


class Block:
    __slots__ = ("selector", "line", "declarations", "children")

    def __init__(self, selector: str, line: int):
        self.selector = selector
        self.line = line
        self.declarations = ""
        self.children: list[Block] = []


def strip_comments(text: str) -> str:
    """Remove comments, preserving newlines so line numbers stay true."""
    return re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)


def parse(text: str) -> list[Block]:
    """Parse CSS/SCSS into a forest.

    A block's declarations are every stretch of its own body that is NOT inside
    a child block — declarations *before* a nested rule included. Both halves of
    that matter: `.cancel` and `.muted` declare their colour before a nested
    rule, and dropping it silently hid them on the first attempt.
    """
    top: list[Block] = []
    stack: list[Block] = []
    chunks: list[list[str]] = []  # each frame's own declaration fragments
    buf = 0
    i, n = 0, len(text)

    while i < n:
        ch = text[i]
        if ch == "{":
            selector = " ".join(text[buf:i].split())
            if stack:
                # the parent's own declarations immediately BEFORE this child
                chunks[-1].append(text[buf:i])
            blk = Block(selector, text.count("\n", 0, buf) + 1)
            (stack[-1].children if stack else top).append(blk)
            stack.append(blk)
            chunks.append([])
            buf = i + 1
        elif ch == "}":
            if stack:
                chunks[-1].append(text[buf:i])
                stack[-1].declarations = "\n".join(chunks[-1])
                stack.pop()
                chunks.pop()
            buf = i + 1
        i += 1
    return top


def split_selectors(selector: str) -> list[str]:
    return [s.strip() for s in selector.split(",") if s.strip()]


def base_selector(selector: str) -> str:
    """`a:hover` -> 'a'; `.x[data-active=false]` -> '.x'; `&::placeholder` -> ''."""
    return PSEUDO_OR_ATTR.sub("", selector).strip().lstrip("&").strip()


def text_colours(declarations: str) -> list[str]:
    return [
        c.strip()
        for c in COLOR_DECL.findall(declarations)
        if "transparent" not in c.lower()
    ]


def sub_one_opacities(declarations: str) -> list[str]:
    out = []
    for raw in OPACITY_DECL.findall(declarations):
        value = raw.strip().rstrip("!important").strip()
        try:
            if float(value) < 1.0:
                out.append(value)
        except ValueError:
            continue  # var()/calc(): cannot prove < 1, so do not guess
    return out


def collect_text_bases(blocks: list[Block], out: set[str]) -> None:
    """Every base selector that ever declares a text colour paints text.

    CSS inherits by selector as well as by nesting: `a { color: ... }` means
    `a:hover` paints text even though the two rules are siblings.
    """
    for blk in blocks:
        if text_colours(blk.declarations):
            for sel in split_selectors(blk.selector):
                base = base_selector(sel)
                if base:
                    out.add(base)
        collect_text_bases(blk.children, out)


def walk(blocks: list[Block], inherited: str | None, kf: bool, text_bases: set[str],
         rel: str, out: list[dict]) -> None:
    for blk in blocks:
        in_kf = kf or bool(KEYFRAMES.match(blk.selector))
        colours = text_colours(blk.declarations)
        own_inherited = colours[0] if colours else inherited

        if not in_kf:
            bad = sub_one_opacities(blk.declarations)
            bases = {base_selector(s) for s in split_selectors(blk.selector)}
            paints_text = (
                bool(colours)
                or inherited is not None
                or any(p in blk.selector for p in TEXT_PSEUDO)
                or bool(bases & text_bases)
            )
            if bad and paints_text:
                out.append({
                    "file": rel,
                    "line": blk.line,
                    "selector": blk.selector or "(nested block)",
                    "color": colours[0] if colours else (inherited or "(inherited)"),
                    "opacity": bad[0],
                })

        walk(blk.children, own_inherited, in_kf, text_bases, rel, out)


def scan(path: Path) -> list[dict]:
    text = strip_comments(path.read_text())
    blocks = parse(text)
    text_bases: set[str] = set()
    collect_text_bases(blocks, text_bases)
    out: list[dict] = []
    walk(blocks, None, False, text_bases, str(path.relative_to(ROOT)), out)
    return out


def main(argv: list[str]) -> int:
    findings: list[dict] = []
    seen: set[Path] = set()
    for path in SOURCES:
        if path.exists() and path not in seen:
            seen.add(path)
            findings.extend(scan(path))
    scanned = len(seen)

    if "--json" in argv:
        print(json.dumps(findings, indent=2))
        return 1 if findings else 0

    if not findings:
        print(f"no rule paints text through opacity in {scanned} stylesheet(s)")
        return 0

    print(f"{len(findings)} rule(s) paint text through opacity — the contrast gate cannot score these:\n")
    for f in findings:
        print(f"  {f['file']}:{f['line']}")
        print(f"    {f['selector']}")
        print(f"    color: {f['color']}   opacity: {f['opacity']}")
        print("    -> the painted pair is not the token pair; use a dimmer COLOUR token instead\n")
    print("See the module docstring of tools/contrast.py: express de-emphasis as a colour token.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
