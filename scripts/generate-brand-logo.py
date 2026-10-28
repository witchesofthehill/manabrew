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
horizontal_light = load("logos/light/manabrew-horizontal-header-light.svg")
symbol_dark = load("logos/dark/manabrew-symbol-dark.svg")
symbol_light = load("logos/light/manabrew-symbol-light.svg")

sources = {
    "horizontal": {"dark": horizontal_dark, "light": horizontal_light},
    "symbol": {"dark": symbol_dark, "light": symbol_light},
}
sprite = ET.Element(f"{{{NS}}}svg", {"viewBox": horizontal_dark.attrib["viewBox"]})
definitions = ET.SubElement(sprite, f"{{{NS}}}defs")
for variant, modes in sources.items():
    for mode, source in modes.items():
        group = ET.SubElement(definitions, f"{{{NS}}}g", {"id": f"mb-{variant}-{mode}"})
        group.extend(clean(node) for node in source if node.tag == f"{{{NS}}}g")

geometry = {
    variant: {
        mode: {
            "viewBox": source.attrib["viewBox"],
            "width": int(source.attrib["width"]),
            "height": int(source.attrib["height"]),
        }
        for mode, source in modes.items()
    }
    for variant, modes in sources.items()
}
(ROOT / "src/assets/brandLogoGeometry.json").write_text(json.dumps(geometry, indent=2) + "\n")

output = ROOT / "images/brand/logos/interactive/manabrew-logo.svg"
output.parent.mkdir(parents=True, exist_ok=True)
ET.indent(sprite)
ET.ElementTree(sprite).write(output, encoding="UTF-8", xml_declaration=True)
print("Generated static logo sprite and geometry from approved brand exports.")
