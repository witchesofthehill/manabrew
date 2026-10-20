import copy
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "images/brand"
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


light = load("logos/color/manabrew-symbol.svg")
dark = load("logos/dark/manabrew-symbol-dark.svg")
liquid = load("layers/manabrew-liquid-bubbles.svg")
fire = load("layers/manabrew-mouth-fire.svg")
mascot = load("mascot/manabrew-mascot.svg")
horizontal = load("logos/color/manabrew-horizontal.svg")

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
wordmark = layer("mb-wordmark", [identified(horizontal, "Manabrew_wordmark___existing_brand_typography_and_colors")])
wordmark.set("transform", "translate(-246 -122.4) scale(1.6)")

output = BRAND / "logos/interactive/manabrew-logo.svg"
output.parent.mkdir(parents=True, exist_ok=True)
ET.indent(sprite)
ET.ElementTree(sprite).write(output, encoding="UTF-8", xml_declaration=True)
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
print("Generated interactive logo sprite and shared geometry from approved brand exports.")
