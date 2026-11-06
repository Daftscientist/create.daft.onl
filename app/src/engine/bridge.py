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
    # Imported slides keep their exact EMU size (e.g. 12188825 wide), while captures come from the
    # rounded CSS px size. A .pptx has one slide size, so captures take the imported size.
    kept = next((ir for ir, s in zip(irs, p["slides"]) if s.get("ir")), None)
    if kept is not None:
        irs = [
            ir.model_copy(update={"width": kept.width, "height": kept.height})
            if abs(ir.width - kept.width) <= kept.width * 0.01 and abs(ir.height - kept.height) <= kept.height * 0.01
            else ir
            for ir in irs
        ]
    faces, font_warnings = resolve_faces(irs, captured_fonts=fonts)
    warnings.extend(w.message for w in font_warnings)
    return json.dumps({"pptx": base64.b64encode(build_pptx(irs, faces=faces)).decode(), "warnings": warnings})


def ping():
    return True


def patch_ir(ir_json, ops_json):
    """Applies geometry and stacking edits to a slide's IR, so a moved or reordered slide keeps
    exporting exactly (charts and other preserved payloads stay native).

    ops: [{"op": "geometry", "id", "x", "y", "w", "h" (px), "rotation" (deg)}, {"op": "order", "ids": [...]}]
    Returns the new IR JSON, or None when an op names a node the IR doesn't have at the top level
    (the caller then drops the IR and the slide is captured on export).
    """
    from domoxml.core.units import px_to_emu

    data = json.loads(ir_json)
    contents = data["contents"]
    by_id = {node.get("node_id"): node for node in contents}
    for op in json.loads(ops_json):
        if op["op"] == "geometry":
            node = by_id.get(op["id"])
            if node is None or "box" not in node:
                return None
            node["box"] = {"x": px_to_emu(op["x"]), "y": px_to_emu(op["y"]), "width": max(1, px_to_emu(op["w"])), "height": max(1, px_to_emu(op["h"]))}
            if "transform" in node or op.get("rotation"):
                transform = node.get("transform") or {}
                transform["rotation_deg"] = float(op.get("rotation") or 0.0)
                node["transform"] = transform
        elif op["op"] == "order":
            if sorted(op["ids"]) != sorted(by_id) or None in by_id:
                return None
            data["contents"] = contents = [by_id[i] for i in op["ids"]]
        else:
            return None
    return SlideIR.model_validate(data).model_dump_json()
