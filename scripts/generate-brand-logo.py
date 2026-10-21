import argparse
import copy
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description="Prepare runtime logos from approved brand exports.")
parser.add_argument("brand_dir", type=Path, help="External folder containing the approved brand exports.")
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


interactive = load("logos/interactive/manabrew-logo.svg")
header = load("logos/color/manabrew-horizontal-header.svg")
fire = load("layers/manabrew-mouth-fire.svg")

sprite = ET.Element(f"{{{NS}}}svg", {"viewBox": interactive.get("viewBox")})
definitions = ET.SubElement(sprite, f"{{{NS}}}defs")


def layer(identifier, nodes):
    group = ET.SubElement(definitions, f"{{{NS}}}g", {"id": identifier})
    group.extend(clean(node) for node in nodes)
    return group


for identifier in [
    "mb-body-light",
    "mb-body-dark",
    "mb-bubble-ember",
    "mb-bubble-mana",
    "mb-bubble-sage",
    "mb-float-sage",
    "mb-float-mana",
    "mb-float-ember",
]:
    definitions.append(copy.deepcopy(identified(interactive, identifier)))

mouth = fire.find(f".//{{{NS}}}clipPath/{{{NS}}}path")
for mode, color in [("light", "#f4eee8"), ("dark", "#272329")]:
    opening = clean(mouth)
    opening.set("fill", color)
    layer(f"mb-mouth-{mode}", [opening])

layer("mb-fire-outer", [identified(fire, "Flame___primary_ember")])
layer("mb-fire-core", [identified(fire, "Flame___golden_heart")])
wordmark = clean(identified(header, "Manabrew___Merienda_Bold_700"))
wordmark.set("id", "mb-wordmark")
definitions.append(wordmark)

geometry = {
    "mouthPath": mouth.get("d"),
    "horizontal": {
        "viewBox": header.get("viewBox"),
        "width": int(header.get("width")),
        "height": int(header.get("height")),
        "mascotTransform": "translate(20 17) scale(0.72)",
    },
    "symbol": {"viewBox": interactive.get("viewBox"), "width": 512, "height": 512},
}
(ROOT / "src/assets/brandLogoGeometry.json").write_text(json.dumps(geometry, indent=2) + "\n")

output = ROOT / "images/brand/logos/interactive/manabrew-logo.svg"
output.parent.mkdir(parents=True, exist_ok=True)
ET.indent(sprite)
ET.ElementTree(sprite).write(output, encoding="UTF-8", xml_declaration=True)
print("Generated interactive logo sprite and geometry from approved brand exports.")
