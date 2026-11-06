"""Generate the sample decks as real domOXML normalized HTML.

Each sample slide is authored as plain HTML/CSS at 1280x720, then run through domOXML's own
pipeline (Chromium capture -> canvas IR -> normalized HTML). The app ships the result, so sample
decks have exactly the shape imported decks will have, and that the AI reads and edits.

usage: <domOXML venv>/bin/python scripts/gen-sample-slides.py fixtures.json src/data/sample-slides.json
"""

from __future__ import annotations

import base64
import html
import json
import re
import sys
from pathlib import Path

from domoxml import Presentation
from domoxml.types import OutputFormat, Slide

ROOT = Path(__file__).resolve().parents[1]
SANS = ROOT / "node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2"
SERIF = ROOT / "node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2"


def font_css() -> str:
    def face(family: str, path: Path, weight: str) -> str:
        data = base64.b64encode(path.read_bytes()).decode()
        return f"@font-face{{font-family:'{family}';src:url(data:font/woff2;base64,{data}) format('woff2');font-weight:{weight}}}"

    return face("Instrument Sans", SANS, "400 700") + face("Instrument Serif", SERIF, "400")


e = html.escape


def slide_html(spec: dict, t: dict) -> str:
    """Every text block and shape is its own absolutely positioned element with explicit geometry
    and line-height (the shape the AI is asked to write, and the most faithful capture path)."""
    sans = "'Instrument Sans', sans-serif"
    display = "'Instrument Serif', serif" if t.get("serif") else sans
    dw = "500" if t.get("serif") else "650"

    def box(x: float, y: float, w: float, h: float, style: str, inner: str = "") -> str:
        return f'<div style="position:absolute;left:{x}px;top:{y}px;width:{w}px;height:{h}px;{style}">{inner}</div>'

    def text(x: float, y: float, w: float, h: float, content: str, size: float, weight: str = "400", color: str | None = None,
             family: str | None = None, lh: float = 1.25, extra: str = "") -> str:
        return box(x, y, w, h, f"font-family:{family or sans};font-size:{size}px;line-height:{lh};font-weight:{weight};color:{color or t['fg']};{extra}", e(content))

    eyebrow = "letter-spacing:.08em;text-transform:uppercase"
    parts: list[str] = []
    k = spec["kind"]
    if k == "title":
        y = 230
        if spec.get("eyebrow"):
            parts.append(text(102, y, 900, 26, spec["eyebrow"], 18, "600", t["accent"], extra=eyebrow))
            y += 44
        lines = 2 if len(spec["title"]) > 26 else 1
        parts.append(text(102, y, 900, 76 * lines, spec["title"], 66, dw, family=display, lh=1.12, extra="letter-spacing:-.02em"))
        y += 76 * lines + 22
        if spec.get("subtitle"):
            parts.append(text(102, y, 900, 32, spec["subtitle"], 24, color=t["muted"]))
        parts.append(box(102, 630, 77, 6, f"border-radius:3px;background:{t['accent']}"))
    elif k == "section":
        parts.append(text(102, 230, 400, 120, spec["index"], 112, "300", t["accent"], lh=1.0, extra="letter-spacing:-.04em"))
        parts.append(text(102, 370, 1000, 72, spec["title"], 58, "600", family=display, lh=1.15))
    elif k == "bullets":
        parts.append(text(102, 90, 1076, 52, spec["title"], 41, "620", family=display, lh=1.2))
        for i, item in enumerate(spec["items"]):
            y = 196 + i * 96
            parts.append(text(102, y + 6, 60, 26, f"{i + 1:02d}", 19, "600", t["accent"]))
            parts.append(text(166, y, 1012, 40, item, 29, lh=1.3))
            if i < len(spec["items"]) - 1:
                parts.append(box(102, y + 66, 1076, 1.5, f"background:{t['muted']}40"))
    elif k == "stat":
        parts.append(text(102, 180, 1076, 190, spec["value"], 180, "640", t["accent"], lh=1.0, extra="letter-spacing:-.05em"))
        parts.append(text(102, 392, 760, 90, spec["label"], 34, lh=1.25))
        if spec.get("note"):
            parts.append(text(102, 500, 760, 28, spec["note"], 20, color=t["muted"]))
    elif k == "chart":
        parts.append(text(102, 90, 1076, 52, spec["title"], 41, "620", family=display, lh=1.2))
        n, top = len(spec["bars"]), max(spec["bars"])
        gap, width = 31, (1076 - 31 * (len(spec["bars"]) - 1)) / len(spec["bars"])
        base_y = 600
        for i, v in enumerate(spec["bars"]):
            x = 102 + i * (width + gap)
            h = v / top * 330
            hi = i == spec.get("highlight")
            parts.append(text(x, base_y - h - 32, width, 24, f"{v:,}", 18, "600" if hi else "400", t["fg"] if hi else t["muted"], extra="text-align:center"))
            parts.append(box(x, base_y - h, width, h, f"border-radius:8px 8px 2px 2px;background:{t['accent'] if hi else t['fg'] + '24'}"))
            parts.append(text(x, base_y + 12, width, 24, spec["labels"][i], 18, color=t["muted"], extra="text-align:center"))
        _ = n
    elif k == "quote":
        lines = max(1, min(4, len(spec["text"]) // 38 + 1))
        parts.append(text(102, 360 - lines * 33, 1050, lines * 66, f"“{spec['text']}”", 54, "500", family=display, lh=1.2, extra="letter-spacing:-.015em"))
        parts.append(text(102, 380 + lines * 33, 900, 28, spec["by"], 20, color=t["muted"]))
    elif k == "split":
        if spec.get("tag"):
            parts.append(text(102, 400, 500, 26, spec["tag"], 18, "600", t["accent"], extra=eyebrow))
        parts.append(text(102, 440, 500, 140, spec["title"], 62, dw, family=display, lh=1.05, extra="letter-spacing:-.025em"))
        parts.append(box(679, 430, 499, 200, f"border-radius:15px;background:{t['surface']}"))
        parts.append(text(710, 458, 437, 150, spec["body"], 27, color=t["muted"], lh=1.4))
    elif k == "grid":
        parts.append(text(102, 90, 1076, 52, spec["title"], 41, "620", family=display, lh=1.2))
        for i, c in enumerate(spec["cells"]):
            x, y = 102 + (i % 2) * 548, 300 + (i // 2) * 160
            parts.append(box(x, y, 528, 140, f"border-radius:15px;background:{t['surface']}"))
            parts.append(text(x + 31, y + 28, 466, 24, c["label"], 18, "500", t["muted"]))
            parts.append(text(x + 31, y + 62, 466, 52, c["value"], 40, "620", lh=1.2, extra="letter-spacing:-.02em"))
    else:
        raise ValueError(k)
    return f'<div style="position:absolute;inset:0;background:{t["bg"]};color:{t["fg"]};font-family:{sans}">{"".join(parts)}</div>'


def main() -> None:
    decks = json.loads(Path(sys.argv[1]).read_text())
    css = font_css()
    out: dict[str, list[str]] = {}
    for deck in decks:
        pres = Presentation(css=css)
        for spec in deck["slides"]:
            pres.add(Slide(html=slide_html(spec, deck["theme"])))
        result = pres.render({OutputFormat.HTML})
        assert result.html is not None
        # Fonts are loaded globally by the app under the same family names: drop embedded copies.
        out[deck["id"]] = [re.sub(r"\s+data-domoxml-font-asset=\"[^\"]*\"", "", s.html) for s in result.html.slides]
        print(deck["id"], len(out[deck["id"]]), "slides", sum(len(h) for h in out[deck["id"]]) // 1024, "KB", flush=True)
    Path(sys.argv[2]).write_text(json.dumps(out))


main()
