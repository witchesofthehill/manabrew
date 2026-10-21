# Manabrew Brush

An original brush-influenced display family with rounded exit strokes, a curled left foot on the M, a rising e crossbar, and a curved w. All letterforms were drawn for this project. Costa was a visual reference, not a source of outlines or font data.

## Install

Open the files in `ttf/` with Font Book on macOS and choose Install. On Windows, select the TTF files and choose Install. The family contains fourteen static styles:

| Weight | Upright   | Italic           |
| ------ | --------- | ---------------- |
| 300    | Light     | Light Italic     |
| 400    | Regular   | Regular Italic   |
| 500    | Medium    | Medium Italic    |
| 600    | SemiBold  | SemiBold Italic  |
| 700    | Bold      | Bold Italic      |
| 800    | ExtraBold | ExtraBold Italic |
| 900    | Black     | Black Italic     |

The italic uses an 11-degree inclination and different constructions for a, e, f, g, k, and y. These are static fonts, not a variable font. Applications that use legacy font menus may list nonstandard weights as separate subfamilies.

## Included

- `ttf/`: installable TrueType fonts.
- `web/`: WOFF2 fonts and `fonts.css` with all weight/style declarations.
- `specimen.png`: family overview.
- `preview.png`: close-up of the revised M and brush terminals in Bold and Black.
- `specimen-regular.png` and `specimen-blackitalic.png`: alphabet and text samples.
- `specimen.pdf`: eight-page specimen with a character map.
- `sources/`: editable glyph paths, the font builder, and the specimen renderer.
- `OFL.txt`: SIL Open Font License 1.1.

Every style contains 375 encoded characters. Coverage includes printable ASCII, Latin-1, Latin Extended-A, Romanian comma-below letters, combining accents, typographic punctuation, and common currency symbols. Greek, Cyrillic, and non-Latin scripts are not included.

OpenType features include kerning, fi/fl/ff/ffi/ffl ligatures, canonical accent composition, mark positioning, and mark stacking. Outlines are unhinted and intended primarily for logos and display sizes; small text will depend on the application's rasterizer.

## Web use

Copy `web/` as a directory so the CSS's relative font URLs remain valid, then load `fonts.css`:

```css
.brand {
  font-family: "Manabrew Brush", sans-serif;
  font-weight: 700;
  font-style: normal;
}
```

## Rebuild

From this directory:

```sh
uv venv .venv
uv pip install --python .venv/bin/python -r sources/requirements.txt
.venv/bin/python sources/build.py
.venv/bin/python sources/specimen.py
```

`capitals.json` and `lowercase.json` contain original cubic centerlines, terminal taper values, and italic alternates. The M uses compatible filled contour masters at the light and black extremes. The builder expands the centerlines with a directional broad nib, interpolates filled masters for intermediate weights, merges overlaps, and writes TTF and WOFF2 files. Numerals, punctuation, marks, and supplementary Latin constructions are in `build.py`.

## Validation

All fourteen TTFs were rendered with FreeType and shaped with HarfBuzz. Checks covered Latin coverage, equivalent composed/decomposed accents, kerning, ligatures, mark attachment and stacking, increasing weight area, clipping bounds, font checksums, and WOFF2 roundtripping. macOS CoreText also registered and resolved all fourteen styles in a process-local smoke run; the fonts were not installed system-wide.

## License

Free for personal and commercial use, including logos, app embedding, self-hosted websites, and modification, under the SIL Open Font License 1.1. Retain the copyright notice and `OFL.txt` when redistributing font files. The font software cannot be sold by itself. No reserved font names are declared.
