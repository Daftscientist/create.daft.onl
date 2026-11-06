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


def _patched(node, geometry):
    """`node` with a new box (px) and rotation, for an object that was only moved or resized. A group
    keeps its child space, so its children move and scale with its box."""
    if geometry is None:
        return node
    from domoxml.core.units import px_to_emu

    data = node.model_dump(mode="json")
    if "box" not in data:
        return node
    data["box"] = {
        "x": px_to_emu(geometry["x"]),
        "y": px_to_emu(geometry["y"]),
        "width": max(1, px_to_emu(geometry["w"])),
        "height": max(1, px_to_emu(geometry["h"])),
    }
    rotation = float(geometry.get("rotation") or 0.0)
    if data.get("transform") is not None or rotation:
        data["transform"] = {**(data.get("transform") or {}), "rotation_deg": rotation}
    return type(node).model_validate(data)


def _splice(original, captured, order, moved, dirty, slide_changed, anim_changed=False):
    """Per-object exactness (Ream's editor spec, contract 2): every node that wasn't edited ships its
    original IR (patched with its new box when it was moved), in the slide's current order; edited and
    new nodes come from the capture."""
    by_id = {n.node_id: n for n in original.contents if n.node_id}
    # Captured nodes by the object they came from; nodes of an object without an id (added by
    # hand-written HTML) follow the object before them.
    buckets, key = {}, None
    for n in captured.contents if captured is not None else ():
        base = (n.node_id or "").split(":")[0]
        own = base in order
        if own:
            key = base
        buckets.setdefault(key, []).append((n, own))
    contents = [n for n, _ in buckets.get(None, [])]
    for nid in order:
        if nid in by_id and nid not in dirty:
            contents.append(_patched(by_id[nid], moved.get(nid)))
            contents.extend(n for n, own in buckets.get(nid, []) if not own)
        else:
            contents.extend(n for n, _ in buckets.get(nid, []))
    base = captured if slide_changed and captured is not None else original
    update = {"contents": contents, "width": original.width, "height": original.height}
    if anim_changed and captured is not None:
        update["animations"] = captured.animations
    return base.model_copy(update=update)


def export_pptx(payload):
    """Each slide is its imported IR (exact), a web snapshot of its HTML (made in Ream), or both: an
    imported slide that was edited keeps the IR of every object that wasn't (see _splice)."""
    p = json.loads(payload)
    fonts = {f"font-{i}": base64.b64decode(b) for i, b in enumerate(p.get("fonts", []))}
    for i, m in enumerate(_FONT_URI.finditer(p.get("css", ""))):
        fonts[f"css-{i}"] = base64.b64decode(m.group(2))
    irs, warnings = [], []
    for s in p["slides"]:
        captured = None
        if s.get("snapshot"):
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
            captured = extracted.slide
            warnings.extend(w.message for w in extracted.warnings)
        if s.get("ir"):
            original = SlideIR.model_validate_json(s["ir"])
            irs.append(
                _splice(
                    original, captured, s.get("order", []), s.get("moved", {}), set(s.get("dirty", [])),
                    s.get("slideChanged", False), s.get("animChanged", False),
                )
                if "order" in s
                else original
            )
        else:
            irs.append(captured)
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
