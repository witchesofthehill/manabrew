import argparse
import copy
import json
from io import BytesIO
from pathlib import Path
import xml.etree.ElementTree as ET

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
import uharfbuzz as hb

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description="Prepare runtime logos with an outlined Merienda Bold wordmark.")
parser.add_argument("brand_dir", type=Path, nargs="?", help="External brand folder; omit to update the existing runtime wordmark only.")
BRAND = parser.parse_args().brand_dir
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)


def load(path):
    return ET.parse(BRAND / path).getroot()


def identified(root, identifier):
    return next(node for node in root.iter() if node.get("id") == identifier)


def clean(node):
    result = copy.deepcopy(node)
    for child in result.iter():
        child.attrib.pop("id", None)
        child.attrib.pop("data-name", None)
    return result


def outline_wordmark(wordmark):
    font = TTFont(ROOT / "node_modules/@fontsource/merienda/files/merienda-latin-700-normal.woff2")
    font.flavor = None
    font_data = BytesIO()
    font.save(font_data)
    shaping_font = hb.Font(hb.Face(font_data.getvalue()))
    hb.ot_font_set_funcs(shaping_font)
    text = hb.Buffer()
    text.add_str("Manabrew")
    text.direction = "ltr"
    text.script = "Latn"
    text.language = "en"
    hb.shape(shaping_font, text, {"kern": True})

    glyphs = font.getGlyphSet()
    bounds = BoundsPen(glyphs)
    positioned = []
    x = y = 0
    for info, position in zip(text.glyph_infos, text.glyph_positions):
        glyph = glyphs[font.getGlyphName(info.codepoint)]
        offset_x = x + position.x_offset
        offset_y = y + position.y_offset
        positioned.append((glyph, offset_x, offset_y))
        glyph.draw(TransformPen(bounds, (1, 0, 0, 1, offset_x, offset_y)))
        x += position.x_advance
        y += position.y_advance

    x_min, y_min, x_max, y_max = bounds.bounds
    left, top, right, bottom = 410.582, 150.202, 1034.332, 259.44
    scale = min((right - left) / (x_max - x_min), (bottom - top) / (y_max - y_min))
    translate_x = (left + right) / 2 - (x_min + x_max) * scale / 2
    translate_y = (top + bottom) / 2 + (y_min + y_max) * scale / 2
    for child in list(wordmark):
        wordmark.remove(child)
    for glyph, offset_x, offset_y in positioned:
        pen = SVGPathPen(glyphs, ntos=lambda value: f"{value:.3f}".rstrip("0").rstrip("."))
        glyph.draw(TransformPen(pen, (
            scale, 0, 0, -scale,
            translate_x + offset_x * scale,
            translate_y - offset_y * scale,
        )))
        ET.SubElement(wordmark, f"{{{NS}}}path", {"d": pen.getCommands(), "fill": "#ec8650"})
    font.close()


output = ROOT / "images/brand/logos/interactive/manabrew-logo.svg"
if BRAND is None:
    sprite = ET.parse(output).getroot()
    wordmark = identified(sprite, "mb-wordmark")
else:
    light = load("logos/color/manabrew-symbol.svg")
    dark = load("logos/dark/manabrew-symbol-dark.svg")
    liquid = load("layers/manabrew-liquid-bubbles.svg")
    fire = load("layers/manabrew-mouth-fire.svg")
    mascot = load("mascot/manabrew-mascot.svg")

    sprite = ET.Element(f"{{{NS}}}svg", {"viewBox": "0 0 512 512"})
    definitions = ET.SubElement(sprite, f"{{{NS}}}defs")

    def layer(identifier, nodes):
        group = ET.SubElement(definitions, f"{{{NS}}}g", {"id": identifier})
        group.extend(clean(node) for node in nodes)
        return group

    liquid_paths = list(liquid.iter(f"{{{NS}}}path"))
    liquid_ids = {node.get("id") for node in liquid_paths}
    for mode, source in [("light", light), ("dark", dark)]:
        body = copy.deepcopy(identified(source, "Layer_1"))
        for parent in body.iter():
            for child in list(parent):
                if child.get("id") in liquid_ids:
                    parent.remove(child)
        layer(f"mb-body-{mode}", [body])

    layer("mb-liquid", [
        identified(liquid, "Mana___violet_potion_surface"),
        identified(liquid, "Mana___left_overflow"),
        identified(liquid, "Mana___right_overflow"),
    ])
    for identifier, source_id in [
        ("mb-bubble-ember", "Primary_ember_bubble___exact_logo_shape"),
        ("mb-bubble-mana", "Secondary_mana_bubble___exact_logo_shape"),
        ("mb-bubble-sage", "Accent_sage_bubble___exact_logo_shape"),
        ("mb-float-sage", "Floating_sage_bubble___shared_logo_contour"),
        ("mb-float-mana", "Floating_mana_drop___shared_logo_contour"),
        ("mb-float-ember", "Floating_ember_drop___shared_logo_contour"),
    ]:
        layer(identifier, [identified(liquid, source_id)])

    mouth = identified(mascot, "Mouth___clean_charcoal_opening___no_lip_band")
    for mode, color_source in [("light", identified(mascot, "Left_eye___exact_logo_shape")), ("dark", mouth)]:
        opening = clean(mouth)
        opening.set("fill", color_source.get("fill"))
        layer(f"mb-mouth-{mode}", [opening])

    layer("mb-fire-outer", [identified(fire, "Flame___primary_ember")])
    layer("mb-fire-core", [identified(fire, "Flame___golden_heart")])
    wordmark = layer("mb-wordmark", [])
    wordmark.set("transform", "translate(-246 -122.4) scale(1.6)")

    geometry = {
        "mouthPath": mouth.get("d"),
        "horizontal": {
            "viewBox": "0 0 1450 400",
            "width": 1450,
            "height": 400,
            "mascotTransform": "translate(20 17) scale(0.72)",
        },
        "symbol": {"viewBox": "0 0 512 512", "width": 512, "height": 512},
    }
    (ROOT / "src/assets/brandLogoGeometry.json").write_text(json.dumps(geometry, indent=2) + "\n")

outline_wordmark(wordmark)
output.parent.mkdir(parents=True, exist_ok=True)
ET.indent(sprite)
ET.ElementTree(sprite).write(output, encoding="UTF-8", xml_declaration=True)
print("Generated interactive logo sprite with an outlined Merienda Bold wordmark.")
