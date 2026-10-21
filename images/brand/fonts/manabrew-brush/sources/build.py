from __future__ import annotations

import argparse
import json
import math
import unicodedata
from pathlib import Path

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.basePen import BasePen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path
from shapely import affinity
from shapely.geometry import GeometryCollection, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
FAMILY = "Manabrew Brush"
WEIGHTS = {"Light": (300, 44), "Regular": (400, 72), "Medium": (500, 88), "SemiBold": (600, 104), "Bold": (700, 120), "ExtraBold": (800, 136), "Black": (900, 150)}


def stroke(d, start=1, end=1, closed=False):
    return {"d": d, "start": start, "end": end, "closed": closed}


def glyph(width, *paths):
    return {"width": width, "strokes": [stroke(p) if isinstance(p, str) else p for p in paths]}


class Samples(BasePen):
    def __init__(self):
        super().__init__(None)
        self.points = []
        self.closed = False

    def _moveTo(self, p):
        self.points.append(p)

    def _lineTo(self, p):
        p0 = self.points[-1]
        n = max(1, math.ceil(math.dist(p0, p) / 7))
        self.points.extend((p0[0] + (p[0] - p0[0]) * i / n, p0[1] + (p[1] - p0[1]) * i / n) for i in range(1, n + 1))

    def _curveToOne(self, p1, p2, p3):
        p0 = self.points[-1]
        n = max(8, math.ceil((math.dist(p0, p1) + math.dist(p1, p2) + math.dist(p2, p3)) / 6))
        for i in range(1, n + 1):
            t = i / n
            u = 1 - t
            self.points.append(tuple(u ** 3 * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t ** 3 * p3[k] for k in (0, 1)))

    def _closePath(self):
        self.closed = True
        if math.dist(self.points[-1], self.points[0]) > 0.01:
            self._lineTo(self.points[0])

    def _endPath(self):
        pass


def ribbon(spec, thickness):
    pen = Samples()
    parse_path(spec["d"], pen)
    pts = pen.points
    if pen.closed and math.dist(pts[0], pts[-1]) < 0.01:
        pts = pts[:-1]
    distances = [0.0]
    for a, b in zip(pts, pts[1:]):
        distances.append(distances[-1] + math.dist(a, b))
    total = max(distances[-1], 1)
    sides = [[], []]
    for i, p in enumerate(pts):
        a = pts[(i - 1) % len(pts)] if pen.closed or i else p
        b = pts[(i + 1) % len(pts)] if pen.closed or i < len(pts) - 1 else p
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy) or 1
        nx, ny = -dy / length, dx / length
        radius = thickness * 0.5 * math.sqrt(nx * nx + 0.40 * ny * ny + 0.17 * nx * ny)
        if not pen.closed:
            t = distances[i] / total
            radius *= 1 - (1 - spec.get("start", 1)) * max(0, 1 - t / 0.16) ** 1.4 - (1 - spec.get("end", 1)) * max(0, 1 - (1 - t) / 0.19) ** 1.4
        sides[0].append((p[0] + nx * radius, p[1] + ny * radius))
        sides[1].append((p[0] - nx * radius, p[1] - ny * radius))
    count = len(pts) if pen.closed else len(pts) - 1
    return unary_union([
        Polygon([sides[0][i], sides[0][(i + 1) % len(pts)], sides[1][(i + 1) % len(pts)], sides[1][i]]).buffer(0)
        for i in range(count)
    ])


def outline(spec, thickness, italic):
    parts = [ribbon(s, thickness) for s in spec.get("strokes", [])]
    if "fillMasters" in spec:
        masters = sorted((float(k), v) for k, v in spec["fillMasters"].items())
        low, high = masters[0], masters[-1]
        t = max(0, min(1, (thickness - low[0]) / (high[0] - low[0])))
        for a, b in zip(low[1], high[1], strict=True):
            first, second = RecordingPen(), RecordingPen()
            parse_path(a, first)
            parse_path(b, second)
            pen = Samples()
            for (op, p), (other_op, q) in zip(first.value, second.value, strict=True):
                if op != other_op or len(p) != len(q):
                    raise ValueError("Incompatible filled contour masters")
                points = [tuple(u + (v - u) * t for u, v in zip(x, y, strict=True)) for x, y in zip(p, q, strict=True)]
                getattr(pen, op)(*points)
            parts.append(Polygon(pen.points).buffer(0))
    for d in spec.get("fills", []):
        pen = Samples()
        parse_path(d, pen)
        parts.append(Polygon(pen.points).buffer(0))
    for x, y, r in spec.get("dots", []):
        parts.append(affinity.scale(Point(x, y).buffer(r * (0.65 + thickness / 180), quad_segs=12), 1, 0.85, origin=(x, y)))
    shape = unary_union(parts).buffer(0).simplify(0.3, preserve_topology=True)
    if italic:
        shape = affinity.affine_transform(shape, [1, math.tan(math.radians(11)), 0, 1, 0, 0])
    return shape


def symbols():
    d = {
        "0": glyph(570, stroke("M 285 675 C 115 675 95 485 95 345 C 95 175 130 25 285 25 C 445 25 475 200 475 345 C 475 505 450 675 285 675 Z", closed=True)),
        "1": glyph(370, stroke("M 75 545 C 125 565 185 625 215 665", .5, 1), "M 215 665 L 215 35", stroke("M 105 35 L 320 35", .6, .5)),
        "2": glyph(540, stroke("M 85 550 C 90 725 450 730 455 555 C 465 415 200 265 95 45 C 215 30 360 30 470 58", .6, .35)),
        "3": glyph(530, stroke("M 90 610 C 215 745 460 685 440 530 C 430 435 345 375 250 360 C 360 375 475 295 460 165 C 450 20 220 -25 80 100", .6, .45)),
        "4": glyph(570, stroke("M 390 35 L 390 665 L 75 225 L 510 225", .85, .6)),
        "5": glyph(540, stroke("M 460 665 L 125 665 L 110 385 C 260 455 460 385 460 200 C 460 20 205 -35 80 95", .55, .5)),
        "6": glyph(550, stroke("M 435 650 C 240 750 85 500 90 265 C 90 90 160 25 280 25 C 405 25 465 120 455 250 C 445 410 225 450 95 285", .45, 1)),
        "7": glyph(520, stroke("M 65 650 C 180 680 320 665 460 665 C 320 475 215 200 175 35", .5, .8)),
        "8": glyph(560, stroke("M 280 360 C 95 420 75 675 280 675 C 490 675 465 435 280 360 C 65 285 40 25 280 25 C 525 25 495 280 280 360 Z", closed=True)),
        "9": glyph(550, stroke("M 115 55 C 325 -65 470 200 460 440 C 455 605 395 675 275 675 C 150 675 85 580 95 450 C 105 290 330 245 460 420", .45, 1)),
        ".": {"width": 240, "dots": [(120, 42, 37)]},
        ",": glyph(240, stroke("M 135 75 C 155 5 125 -65 75 -95", 1, .25)),
        ":": {"width": 250, "dots": [(125, 42, 33), (125, 400, 33)]},
        ";": {"width": 250, "dots": [(125, 400, 33)], "strokes": [stroke("M 140 75 C 160 5 130 -65 80 -95", 1, .25)]},
        "!": {"width": 260, "dots": [(130, 42, 34)], "strokes": [stroke("M 130 675 C 120 510 120 345 130 215", 1, .55)]},
        "?": {"width": 490, "dots": [(220, 42, 34)], "strokes": [stroke("M 80 565 C 90 725 410 730 410 555 C 410 445 210 405 220 215", .6, .65)]},
        "'": glyph(200, stroke("M 110 710 L 90 540", 1, .35)),
        '"': glyph(340, stroke("M 105 710 L 85 540", 1, .35), stroke("M 250 710 L 230 540", 1, .35)),
        "(": glyph(340, stroke("M 265 765 C 35 595 35 85 265 -85", .4, .4)),
        ")": glyph(340, stroke("M 75 765 C 305 595 305 85 75 -85", .4, .4)),
        "[": glyph(340, "M 270 750 L 115 750 L 115 -75 L 270 -75"),
        "]": glyph(340, "M 70 750 L 225 750 L 225 -75 L 70 -75"),
        "{": glyph(400, stroke("M 320 750 C 120 750 205 565 165 445 C 150 400 110 365 75 340 C 110 320 150 285 165 235 C 205 115 120 -75 320 -75", .5, .5)),
        "}": glyph(400, stroke("M 80 750 C 280 750 195 565 235 445 C 250 400 290 365 325 340 C 290 320 250 285 235 235 C 195 115 280 -75 80 -75", .5, .5)),
        "-": glyph(360, stroke("M 60 275 L 300 275", .65, .65)),
        "_": glyph(570, "M 40 -110 L 530 -110"),
        "+": glyph(550, "M 75 310 L 475 310", "M 275 100 L 275 520"),
        "±": glyph(550, "M 75 380 L 475 380", "M 275 170 L 275 590", "M 75 35 L 475 35"),
        "=": glyph(550, "M 75 415 L 475 415", "M 75 205 L 475 205"),
        "/": glyph(460, stroke("M 60 -65 L 400 735", .7, .7)),
        "\\": glyph(460, stroke("M 60 735 L 400 -65", .7, .7)),
        "|": glyph(240, "M 120 -130 L 120 780"),
        "<": glyph(550, stroke("M 465 560 L 85 315 L 465 70", .6, .6)),
        ">": glyph(550, stroke("M 85 560 L 465 315 L 85 70", .6, .6)),
        "~": glyph(570, stroke("M 65 280 C 195 450 345 150 505 330", .55, .55)),
        "^": glyph(500, stroke("M 70 450 L 250 665 L 430 450", .6, .6)),
        "`": glyph(250, stroke("M 65 735 L 190 595", .7, .5)),
        "*": glyph(480, "M 240 715 L 240 365", "M 75 625 L 405 450", "M 75 450 L 405 625"),
        "#": glyph(650, "M 255 700 L 155 0", "M 495 700 L 395 0", "M 65 465 L 595 465", "M 40 235 L 570 235"),
        "%": {"width": 780, "strokes": [stroke("M 130 10 L 660 690", .7, .7), stroke("M 205 675 C 55 675 55 390 205 390 C 355 390 355 675 205 675 Z", closed=True), stroke("M 575 310 C 425 310 425 25 575 25 C 725 25 725 310 575 310 Z", closed=True)]},
        "&": glyph(720, stroke("M 645 35 C 530 120 135 450 135 580 C 135 725 385 715 380 575 C 375 440 80 365 80 205 C 80 -35 530 -80 595 330", .65, .45)),
        "@": glyph(930, stroke("M 770 80 C 665 -40 220 -75 105 195 C -45 555 245 795 565 715 C 920 635 890 195 685 185 C 590 180 625 355 650 495", .5, .7), stroke("M 635 440 C 470 600 330 445 335 285 C 340 125 540 135 625 350", .9, .8)),
        "$": glyph(560, stroke("M 465 590 C 260 785 40 590 130 445 C 200 335 445 370 460 200 C 480 15 195 -30 75 110", .65, .5), stroke("M 285 785 L 255 -75", .6, .6)),
        "€": glyph(620, stroke("M 535 590 C 285 815 95 575 110 320 C 120 50 335 -30 530 105", .5, .5), "M 55 420 L 410 420", "M 55 265 L 355 265"),
        "£": glyph(580, stroke("M 475 605 C 290 795 115 590 205 370 C 245 245 185 95 90 35 C 230 95 365 -10 490 65", .5, .6), "M 90 330 L 375 330"),
        "¥": glyph(620, "M 80 665 L 310 355 L 540 665", "M 310 355 L 310 35", "M 90 345 L 530 345", "M 90 185 L 530 185"),
        "×": glyph(550, "M 95 495 L 455 125", "M 95 125 L 455 495"),
        "÷": {"width": 550, "dots": [(275, 110, 30), (275, 510, 30)], "strokes": [stroke("M 75 310 L 475 310")]},
        "°": glyph(350, stroke("M 175 710 C 35 710 35 470 175 470 C 315 470 315 710 175 710 Z", closed=True)),
        "•": {"width": 380, "dots": [(190, 300, 58)]},
        "·": {"width": 240, "dots": [(120, 280, 28)]},
        "…": {"width": 650, "dots": [(110, 42, 30), (325, 42, 30), (540, 42, 30)]},
        "–": glyph(620, "M 60 275 L 560 275"),
        "—": glyph(950, "M 60 275 L 890 275"),
        "−": glyph(550, "M 75 310 L 475 310"),
        "†": glyph(500, "M 250 760 L 250 -90", "M 65 510 L 435 510"),
        "‡": glyph(500, "M 250 760 L 250 -90", "M 65 555 L 435 555", "M 65 145 L 435 145"),
        "¶": glyph(660, "M 395 35 L 395 665 L 295 665 C 30 665 30 300 295 300 L 395 300", "M 565 665 L 565 35"),
        "§": glyph(550, stroke("M 445 650 C 230 820 45 560 200 455 L 385 330 C 570 195 305 40 155 180 C -10 315 160 495 310 390 L 390 335 C 600 160 335 -130 100 50", .5, .5)),
        "¡": {"width": 260, "dots": [(130, 470, 34)], "strokes": [stroke("M 130 -175 C 120 -10 120 155 130 285", 1, .55)]},
        "¿": {"width": 490, "dots": [(260, 470, 34)], "strokes": [stroke("M 410 -65 C 400 -225 80 -230 80 -55 C 80 55 280 95 270 285", .6, .65)]},
        "¬": glyph(550, "M 70 420 L 470 420 L 470 175"),
        "¤": glyph(600, stroke("M 300 530 C 50 530 50 130 300 130 C 550 130 550 530 300 530 Z", closed=True), "M 90 570 L 175 485", "M 425 485 L 510 570", "M 90 90 L 175 175", "M 425 175 L 510 90"),
        "¦": glyph(240, "M 120 780 L 120 390", "M 120 220 L 120 -130"),
    }
    d['“'] = glyph(400, stroke("M 150 720 C 70 655 70 590 105 545", .3, 1), stroke("M 315 720 C 235 655 235 590 270 545", .3, 1))
    d['”'] = glyph(400, stroke("M 105 720 C 145 655 145 600 65 545", 1, .3), stroke("M 270 720 C 310 655 310 600 230 545", 1, .3))
    d['‘'] = glyph(230, stroke("M 150 720 C 70 655 70 590 105 545", .3, 1))
    d['’'] = glyph(230, stroke("M 105 720 C 145 655 145 600 65 545", 1, .3))
    d['‚'] = glyph(230, stroke("M 105 95 C 145 30 145 -25 65 -80", 1, .3))
    d['„'] = glyph(400, stroke("M 105 95 C 145 30 145 -25 65 -80", 1, .3), stroke("M 270 95 C 310 30 310 -25 230 -80", 1, .3))
    d['«'] = glyph(600, "M 275 480 L 80 275 L 275 70", "M 520 480 L 325 275 L 520 70")
    d['»'] = glyph(600, "M 80 480 L 275 275 L 80 70", "M 325 480 L 520 275 L 325 70")
    d['‹'] = glyph(350, "M 275 480 L 80 275 L 275 70")
    d['›'] = glyph(350, "M 80 480 L 275 275 L 80 70")
    return d


def mark_specs():
    return {
        '\u0300': glyph(0, stroke("M -90 110 L 40 5", .65, .5)),
        '\u0301': glyph(0, stroke("M -40 5 L 100 115", .5, .65)),
        '\u0302': glyph(0, stroke("M -125 5 L 0 115 L 125 5", .55, .55)),
        '\u0303': glyph(0, stroke("M -135 25 C -50 170 45 -70 135 65", .5, .5)),
        '\u0304': glyph(0, stroke("M -125 50 L 125 50", .6, .6)),
        '\u0306': glyph(0, stroke("M -125 100 C -100 -25 100 -25 125 100", .6, .6)),
        '\u0307': {"width": 0, "dots": [(0, 55, 28)]},
        '\u0308': {"width": 0, "dots": [(-85, 55, 26), (85, 55, 26)]},
        '\u030a': glyph(0, stroke("M 0 145 C -120 145 -120 -15 0 -15 C 120 -15 120 145 0 145 Z", closed=True)),
        '\u030b': glyph(0, stroke("M -130 0 L -30 115", .5, .65), stroke("M 30 0 L 130 115", .5, .65)),
        '\u030c': glyph(0, stroke("M -125 115 L 0 5 L 125 115", .55, .55)),
        '\u0327': glyph(0, stroke("M 15 0 L -35 -55 C 100 -30 125 -165 -50 -135", .75, .4)),
        '\u0328': glyph(0, stroke("M 55 0 C -80 -70 -45 -185 85 -125", .75, .4)),
        '\u0326': glyph(0, stroke("M 20 -35 C 45 -85 20 -130 -25 -155", 1, .3)),
    }


def name(char):
    return f"uni{ord(char):04X}"


def polygons(shape):
    if shape.geom_type == "Polygon":
        yield shape
    elif hasattr(shape, "geoms"):
        for part in shape.geoms:
            yield from polygons(part)


def to_glyph(shape):
    pen = TTGlyphPen(None)
    for poly in polygons(shape):
        poly = orient(poly, sign=-1)
        for ring in [poly.exterior, *poly.interiors]:
            coords = [(round(x), round(y)) for x, y in ring.coords[:-1]]
            coords = [p for i, p in enumerate(coords) if i == 0 or p != coords[i - 1]]
            if len(set(coords)) < 3:
                continue
            pen.moveTo(coords[0])
            for p in coords[1:]:
                pen.lineTo(p)
            pen.closePath()
    return pen.glyph()


def build(weight_name, italic=False):
    weight, thickness = WEIGHTS[weight_name]
    sources = [json.loads((ROOT / 'sources' / f).read_text()) for f in ('capitals.json', 'lowercase.json')]
    specs = symbols()
    for source in sources:
        specs.update(source['glyphs'])
        if italic:
            specs.update(source.get('italicOverrides', {}))
    specs['ı'] = glyph(245, stroke("M 105 465 L 105 100 C 105 20 155 20 190 55", .8, .25))
    specs['ȷ'] = glyph(300, stroke("M 185 465 L 185 -50 C 185 -190 70 -210 35 -135", .8, .4))
    shapes = {}
    advances = {}
    bearings = {}
    sb = round(47 - (thickness - 72) * .06)
    for char, spec in specs.items():
        shape = outline(spec, thickness, italic)
        if shape.is_empty:
            raise ValueError(f"Empty outline {char}")
        xmin, ymin, xmax, ymax = shape.bounds
        dx = sb - xmin
        shapes[char] = affinity.translate(shape, xoff=dx)
        advances[char] = round(xmax - xmin + 2 * sb)
        bearings[char] = sb
    marks = mark_specs()
    for char, spec in marks.items():
        shapes[char] = outline(spec, thickness * .76, italic)
        advances[char] = 0
        bearings[char] = math.floor(shapes[char].bounds[0])
    for char in (' ', '\u00a0', '\u2002', '\u2003', '\u2009', '\u202f', '\u200b', '\u00ad'):
        shapes[char] = GeometryCollection()
        advances[char] = {'\u2002': 500, '\u2003': 1000, '\u2009': 170, '\u202f': 170, '\u200b': 0, '\u00ad': 0}.get(char, 280)
        bearings[char] = 0
    compositions = []
    candidates = list(range(0xC0, 0x180)) + list(range(0x1FA, 0x200)) + list(range(0x218, 0x21C))
    for cp in candidates:
        char = chr(cp)
        decomposed = unicodedata.normalize('NFD', char)
        if len(decomposed) < 2 or decomposed[0] not in shapes or not all(m in marks for m in decomposed[1:]):
            continue
        base = decomposed[0]
        body = shapes['ı' if base == 'i' else 'ȷ' if base == 'j' else base]
        cx = advances[base] / 2
        upper = base.isupper()
        top = 770 if upper else 570
        parts = [body]
        for mark in decomposed[1:]:
            bottom = mark in ('\u0327', '\u0328', '\u0326')
            y = -15 if bottom else top
            x = cx + (y * math.tan(math.radians(11)) * .22 if italic else 0)
            parts.append(affinity.translate(shapes[mark], xoff=x, yoff=y))
            if not bottom:
                top += 155
        shapes[char] = unary_union(parts)
        advances[char] = advances[base]
        bearings[char] = math.floor(shapes[char].bounds[0])
        compositions.append((char, decomposed))

    def combine(char, pieces, width=None):
        parts = []
        cursor = 0
        for key, sx, sy, y in pieces:
            parts.append(affinity.translate(affinity.scale(shapes[key], sx, sy, origin=(0, 0)), xoff=cursor, yoff=y))
            cursor += advances[key] * sx - 18
        shapes[char] = unary_union(parts)
        advances[char] = round(width if width is not None else cursor + 18)
        bearings[char] = math.floor(shapes[char].bounds[0])

    def add_bar(char, base, d):
        extra = outline(glyph(advances[base], d), thickness * .72, italic)
        shapes[char] = unary_union([shapes[base], extra])
        advances[char] = advances[base]
        bearings[char] = math.floor(shapes[char].bounds[0])

    for char, base, y in [('Đ', 'D', 345), ('Ð', 'D', 345), ('đ', 'd', 580), ('Ħ', 'H', 495), ('ħ', 'h', 580), ('Ŧ', 'T', 420), ('ŧ', 't', 250)]:
        add_bar(char, base, f"M 5 {y} L {advances[base] - 5} {y}")
    for char, base in [('Ł', 'L'), ('ł', 'l'), ('Ø', 'O'), ('ø', 'o')]:
        a = advances[base]
        h = 500 if base.islower() else 700
        add_bar(char, base, f"M 10 {h * .2} L {a - 10} {h * .8}")
    for char, left, right in [('Æ', 'A', 'E'), ('æ', 'a', 'e'), ('Œ', 'O', 'E'), ('œ', 'o', 'e'), ('Ĳ', 'I', 'J'), ('ĳ', 'i', 'j')]:
        combine(char, [(left, .83, 1, 0), (right, .83, 1, 0)])
    specs_extra = {
        'ß': glyph(560, stroke("M 95 35 L 95 510 C 95 770 455 785 445 585 C 440 490 335 445 290 390 C 535 365 555 20 290 35", 1, .35)),
        'ð': glyph(540, stroke("M 155 715 C 450 655 485 455 460 265 C 445 85 375 25 270 25 C 75 25 45 465 270 465 C 365 465 435 395 460 265", .55, 1), "M 145 545 L 395 715"),
        'þ': glyph(560, "M 110 705 L 110 -175", stroke("M 110 375 C 305 575 470 445 470 255 C 470 55 280 -40 110 155", .85, .85)),
        'Þ': glyph(600, "M 110 665 L 110 35", stroke("M 110 535 C 370 600 500 510 500 365 C 500 220 345 160 110 205", 1, 1)),
        'ŋ': glyph(570, stroke("M 105 35 L 105 465", .85, .85), stroke("M 105 345 C 275 560 440 490 440 315 L 440 -40 C 440 -185 340 -210 270 -150", .8, .4)),
        'Ŋ': glyph(670, "M 110 35 L 110 665 L 545 35", stroke("M 545 665 L 545 -55 C 545 -190 435 -210 365 -150", .85, .4)),
        'ſ': glyph(350, stroke("M 125 35 L 125 535 C 125 725 250 780 315 690", 1, .4), "M 40 465 L 285 465"),
        'ĸ': glyph(520, "M 110 465 L 110 35", stroke("M 445 475 C 400 335 245 245 110 200", .4, .8), stroke("M 275 275 C 310 135 390 15 470 55", 1, .3)),
    }
    for char, spec in specs_extra.items():
        shape = outline(spec, thickness, italic)
        x0, _, x1, _ = shape.bounds
        shapes[char] = affinity.translate(shape, xoff=sb - x0)
        advances[char] = round(x1 - x0 + 2 * sb)
        bearings[char] = sb
    combine('Ŀ', [('L', 1, 1, 0), ('·', .65, 1, 100)])
    combine('ŀ', [('l', 1, 1, 0), ('·', .65, 1, 70)])
    combine('ŉ', [('’', .65, 1, 0), ('n', 1, 1, 0)])
    for char, base in [('¹', '1'), ('²', '2'), ('³', '3'), ('ª', 'a'), ('º', 'o')]:
        combine(char, [(base, .62, .62, 300)])
    for char, top, bottom in [('¼', '1', '4'), ('½', '1', '2'), ('¾', '3', '4')]:
        combine(char, [(top, .55, .55, 340), ('/', .42, .85, 30), (bottom, .55, .55, 0)])
    add_bar('¢', 'c', f"M {advances['c'] * .5} -80 L {advances['c'] * .5} 590")
    for char, inner in [('©', 'C'), ('®', 'R')]:
        circ = outline(glyph(900, stroke("M 440 740 C -15 740 -15 -40 440 -40 C 895 -40 895 740 440 740 Z", closed=True)), thickness * .60, italic)
        body = affinity.translate(affinity.scale(shapes[inner], .62, .62, origin=(0, 0)), xoff=250 - advances[inner] * .07, yoff=140)
        shapes[char] = unary_union([circ, body])
        advances[char] = 900
        bearings[char] = math.floor(shapes[char].bounds[0])
    combine('™', [('T', .55, .55, 330), ('M', .55, .55, 330)])
    for char, mark in [('¨', '\u0308'), ('¯', '\u0304'), ('´', '\u0301'), ('¸', '\u0327'), ('ˆ', '\u0302'), ('ˇ', '\u030c'), ('˘', '\u0306'), ('˙', '\u0307'), ('˚', '\u030a'), ('˛', '\u0328'), ('˜', '\u0303'), ('˝', '\u030b')]:
        y = 0 if mark == '\u0327' else 570
        shapes[char] = affinity.translate(shapes[mark], xoff=180, yoff=y)
        advances[char] = 360
        bearings[char] = math.floor(shapes[char].bounds[0])
    ligatures = {}
    for text in ('fi', 'fl', 'ff', 'ffi', 'ffl'):
        char = {'fi': 'ﬁ', 'fl': 'ﬂ', 'ff': 'ﬀ', 'ffi': 'ﬃ', 'ffl': 'ﬄ'}[text]
        combine(char, [(c, 1, 1, 0) for c in text])
        ligatures[text] = char
    shapes['\u00b5'] = affinity.translate(shapes['u'].union(outline(glyph(500, 'M 70 200 L 70 -175'), thickness, italic)), xoff=0)
    advances['\u00b5'] = advances['u']
    bearings['\u00b5'] = math.floor(shapes['\u00b5'].bounds[0])
    cmap = {ord(c): name(c) for c in sorted(shapes, key=ord)}
    order = ['.notdef', *cmap.values()]
    notdef = outline(glyph(600, 'M 80 0 L 80 700 L 520 700 L 520 0 Z', 'M 80 0 L 520 700'), 45, False)
    glyfs = {'.notdef': to_glyph(notdef)}
    metrics = {'.notdef': (600, 57)}
    for char, shape in shapes.items():
        glyfs[name(char)] = to_glyph(shape)
        metrics[name(char)] = (advances[char], bearings[char])
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyfs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=1100, descent=-350, lineGap=0, caretSlopeRise=1000, caretSlopeRun=194 if italic else 0)
    style = f"{weight_name}{' Italic' if italic else ''}"
    legacy_family = FAMILY if weight_name in ('Regular', 'Bold') else f"{FAMILY} {weight_name}"
    legacy_style = ('Bold' if weight_name == 'Bold' else '') + (' Italic' if italic else '')
    legacy_style = legacy_style.strip() or 'Regular'
    ps = FAMILY.replace(' ', '') + '-' + style.replace(' ', '')
    fb.setupNameTable({'familyName': legacy_family, 'styleName': legacy_style, 'uniqueFontIdentifier': f"1.000;MNBR;{ps}", 'fullName': f"{FAMILY} {style}", 'psName': ps, 'version': 'Version 1.000', 'typographicFamily': FAMILY, 'typographicSubfamily': style, 'copyright': 'Copyright 2026 The Manabrew Brush Project Authors', 'manufacturer': 'Manabrew Brush Project', 'designer': 'Manabrew Brush Project', 'description': 'Original broad-nib brush lettering. Independently drawn outlines; no third-party font outlines used.', 'licenseDescription': 'Licensed under the SIL Open Font License, Version 1.1.', 'licenseInfoURL': 'https://openfontlicense.org'})
    selection = (1 if italic else 0) | (32 if weight_name == 'Bold' else 0) | (64 if weight_name == 'Regular' and not italic else 0) | 128 | 256
    fb.setupOS2(version=4, sTypoAscender=1100, sTypoDescender=-350, sTypoLineGap=0, usWinAscent=1120, usWinDescent=370, usWeightClass=weight, usWidthClass=5, fsType=0, fsSelection=selection, sxHeight=500, sCapHeight=700, achVendID='MNBR')
    fb.font['head'].macStyle = (1 if weight_name == 'Bold' else 0) | (2 if italic else 0)
    fb.setupPost(italicAngle=-11 if italic else 0, underlinePosition=-115, underlineThickness=55)
    fb.setupMaxp()
    features = ['languagesystem DFLT dflt;', 'languagesystem latn dflt;']
    for c in marks:
        features.append(f"markClass {name(c)} <anchor 0 0> @{'BOTTOM' if c in ('\u0327', '\u0328', '\u0326') else 'TOP'};")
    features.append('feature mark {')
    for c in shapes:
        if c.isalpha() and c not in marks:
            x = advances[c] // 2
            top = 770 if c.isupper() else 570
            features.append(f"pos base {name(c)} <anchor {x} {top}> mark @TOP <anchor {x} -15> mark @BOTTOM;")
    features.append('} mark;')
    features.append('feature mkmk {')
    for c in marks:
        bottom = c in ('\u0327', '\u0328', '\u0326')
        features.append(f"pos mark {name(c)} <anchor 0 {-180 if bottom else 170}> mark @{'BOTTOM' if bottom else 'TOP'};")
    features.append('} mkmk;')
    features.append('feature ccmp {')
    for c, decomposition in sorted(compositions, key=lambda x: -len(x[1])):
        features.append(f"sub {' '.join(name(x) for x in decomposition)} by {name(c)};")
    features.append('} ccmp;')
    features.append('feature liga {')
    for text, char in sorted(ligatures.items(), key=lambda x: -len(x[0])):
        features.append(f"sub {' '.join(name(c) for c in text)} by {name(char)};")
    features.append('} liga;')
    pairs = {'AV': -65, 'AW': -50, 'AY': -65, 'AT': -42, 'VA': -65, 'WA': -50, 'YA': -65, 'Ta': -50, 'Te': -48, 'To': -52, 'Tu': -35, 'Ty': -40, 'Va': -40, 'Vo': -35, 'Wa': -32, 'Wo': -28, 'Ya': -55, 'Yo': -55, 'Ye': -50, 'FA': -35, 'Fo': -25, 'Pa': -25, 'LT': -35, 'LV': -40, 'LY': -48, 'ry': -15, 'rt': -12, 'we': -12, 'br': -12, 'Ma': -12}
    features.append('feature kern {')
    equivalents = {}
    for c in shapes:
        base = unicodedata.normalize('NFD', c)[0]
        equivalents.setdefault(base, []).append(c)
    kern_pairs = {}
    for text, value in pairs.items():
        for a in equivalents.get(text[0], [text[0]]):
            for b in equivalents.get(text[1], [text[1]]):
                kern_pairs[(name(a), name(b))] = value
    for (a, b), value in sorted(kern_pairs.items()):
        features.append(f"pos {a} {b} {value};")
    features.append('} kern;')
    addOpenTypeFeaturesFromString(fb.font, '\n'.join(features))
    fb.font['head'].created = fb.font['head'].modified = 3875385600
    fb.font.recalcTimestamp = False
    dest = ROOT / 'ttf' / f"{ps}.ttf"
    dest.parent.mkdir(exist_ok=True)
    fb.font.save(dest)
    web = ROOT / 'web'
    web.mkdir(exist_ok=True)
    fb.font.flavor = 'woff2'
    fb.font.save(web / f"{ps}.woff2")
    print(f"{dest.name}: {len(cmap)} encoded glyphs, {weight} weight, {'italic' if italic else 'upright'}")
    return dest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--weight', choices=WEIGHTS)
    parser.add_argument('--italic', action='store_true')
    args = parser.parse_args()
    if args.weight:
        build(args.weight, args.italic)
    else:
        for weight in WEIGHTS:
            for italic in (False, True):
                build(weight, italic)
    rules = []
    for label, (weight, _) in WEIGHTS.items():
        for italic in (False, True):
            suffix = label + ('Italic' if italic else '')
            rules.append(f"@font-face {{\n  font-family: 'Manabrew Brush';\n  font-style: {'italic' if italic else 'normal'};\n  font-weight: {weight};\n  font-display: swap;\n  src: url('./ManabrewBrush-{suffix}.woff2') format('woff2');\n}}")
    (ROOT / 'web' / 'fonts.css').write_text('\n\n'.join(rules) + '\n')


if __name__ == '__main__':
    main()
