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


def clean(node):
    result = copy.deepcopy(node)
    for child in result.iter():
        child.attrib.pop("id", None)
        child.attrib.pop("data-name", None)
    return result


horizontal_dark = load("logos/dark/manabrew-horizontal-dark.svg")
horizontal_light = copy.deepcopy(horizontal_dark)
light_palette = load("logos/light/manabrew-horizontal-light.svg")
light_paths = {
    node.get("id"): node
    for node in light_palette.iter(f"{{{NS}}}path")
    if node.get("id")
}
for node in horizontal_light.iter(f"{{{NS}}}path"):
    if node.get("id"):
        node.set("fill", light_paths[node.get("id")].attrib["fill"])

# The light export still has older proportions. Only take its wordmark ink;
# both horizontal modes retain the latest dark export's balanced geometry.
wordmark_id = "Manabrew___Alegreya_Sans_Bold_700"
light_wordmark = light_palette.find(f".//*[@id='{wordmark_id}']/{{{NS}}}path")
horizontal_light.find(f".//*[@id='{wordmark_id}']/{{{NS}}}path").set(
    "fill", light_wordmark.attrib["fill"]
)
symbol_dark = load("logos/dark/manabrew-symbol-dark.svg")
symbol_light = load("logos/light/manabrew-symbol-light.svg")

sprite = ET.Element(f"{{{NS}}}svg", {"viewBox": horizontal_dark.attrib["viewBox"]})
definitions = ET.SubElement(sprite, f"{{{NS}}}defs")
for identifier, source in [
    ("mb-horizontal-dark", horizontal_dark),
    ("mb-horizontal-light", horizontal_light),
    ("mb-symbol-dark", symbol_dark),
    ("mb-symbol-light", symbol_light),
]:
    group = ET.SubElement(definitions, f"{{{NS}}}g", {"id": identifier})
    group.extend(clean(node) for node in source if node.tag == f"{{{NS}}}g")

geometry = {
    variant: {
        "viewBox": source.attrib["viewBox"],
        "width": int(source.attrib["width"]),
        "height": int(source.attrib["height"]),
    }
    for variant, source in [("horizontal", horizontal_dark), ("symbol", symbol_dark)]
}
(ROOT / "src/assets/brandLogoGeometry.json").write_text(json.dumps(geometry, indent=2) + "\n")

output = ROOT / "images/brand/logos/interactive/manabrew-logo.svg"
output.parent.mkdir(parents=True, exist_ok=True)
ET.indent(sprite)
ET.ElementTree(sprite).write(output, encoding="UTF-8", xml_declaration=True)
print("Generated static logo sprite and geometry from approved brand exports.")
