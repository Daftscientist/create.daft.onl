"""Ream's bridge into domOXML, run inside Pyodide. JSON in and out (bytes as base64)."""

import base64
import json
import mimetypes
import re

from domoxml.core.fonts import resolve_faces
from domoxml.core.html import serialize_canvas
from domoxml.core.ir import SlideIR, extract_slide
from domoxml.core.render import RenderedNode, RenderedSlide, compose_page
from domoxml.slides import build_pptx, read_pptx_result
from domoxml.types import Theme

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("image/svg+xml", ".svg")


def _data_uri(path, data):
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def _inline(text, assets):
    """Swap asset paths for data URIs, so each slide is self-contained (it syncs and renders anywhere)."""
    # Slides reference assets relative to their own directory ("../assets/x.png").
    for path, uri in assets.items():
        text = text.replace(f"../{path}", uri).replace(path, uri)
    return text


def import_pptx(data):
    result = read_pptx_result(bytes(data))
    html = serialize_canvas(
        list(result.slides),
        warnings=result.warnings,
        preserved=result.preserved,
        embedded_fonts=result.embedded_fonts,
        coverage=result.coverage,
    )
    # Longest paths first, so a path that prefixes another can't clobber it.
    assets = {a.path: _data_uri(a.path, a.data) for a in sorted(html.assets, key=lambda a: -len(a.path))}
    return json.dumps(
        {
            "slides": [
                {"html": _inline(s.html, assets), "w": s.width_px, "h": s.height_px, "ir": ir.model_dump_json()}
                for s, ir in zip(html.slides, result.slides, strict=True)
            ],
            "css": _inline(html.css, assets),
            "warnings": [w.message for w in html.warnings],
        }
    )


def compose(slide_html, css, width, height):
    return compose_page(slide_html, css=css or None, theme=Theme(), width_px=width, height_px=height)


_FONT_URI = re.compile(r"url\((['\"]?)data:[^;,]+;base64,([A-Za-z0-9+/=]+)\1\)")


def export_pptx(payload):
    """Slides carry either their imported IR (unchanged since import: exact) or a web snapshot
    of their current HTML (edited), which domOXML extracts exactly as it would a Chromium one."""
    p = json.loads(payload)
    fonts = {f"font-{i}": base64.b64decode(b) for i, b in enumerate(p.get("fonts", []))}
    for i, m in enumerate(_FONT_URI.finditer(p.get("css", ""))):
        fonts[f"css-{i}"] = base64.b64decode(m.group(2))
    irs, warnings = [], []
    for s in p["slides"]:
        if s.get("ir"):
            irs.append(SlideIR.model_validate_json(s["ir"]))
            continue
        snap = s["snapshot"]
        resources = {url: base64.b64decode(b) for url, b in snap.get("resources", {}).items()}
        fonts.update(resources)
        rendered = RenderedSlide(
            width=snap["width"],
            height=snap["height"],
            nodes=tuple(RenderedNode.model_validate(n) for n in snap["nodes"]),
            resources=resources,
        )
        extracted = extract_slide(rendered)
        irs.append(extracted.slide)
        warnings.extend(w.message for w in extracted.warnings)
    faces, font_warnings = resolve_faces(irs, captured_fonts=fonts)
    warnings.extend(w.message for w in font_warnings)
    return json.dumps({"pptx": base64.b64encode(build_pptx(irs, faces=faces)).decode(), "warnings": warnings})


def ping():
    return True
