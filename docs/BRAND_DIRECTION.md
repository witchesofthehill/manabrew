# Manabrew brand direction

Status: implemented for app, game UI, landing page, blog and documentation typography and colors. The approved horizontal cauldron lockup and symbol are integrated with transparent backgrounds. Light/dark modes and personal color overrides remain; alternate theme presets do not return.

## The idea

A slightly ridiculous cauldron, serious about the game.

The cauldron makes the name tangible. Ember is the heat under the pot; purple is the mana inside it. Sage supplies occasional botanical detail. Warm soot and pale steam support those colors. The personality belongs in the silhouette, wordmark and a few illustrations, not in every control.

Avoid a medieval tavern, Halloween merchandise, neon esports, or a potion-shop UI. Specifically, avoid equal areas of orange and purple against pure black, distressed parchment, blackletter, metallic gold trim, and decorative glows around ordinary buttons. These are design judgments, not claims that another brand owns those treatments.

Color and a freely available font cannot establish exclusive identity. The recognizable asset should be the cauldron's proportions and its relationship to a custom-spaced Manabrew wordmark. This research is not trademark clearance.

## Color families

Keep the existing anchors exactly: ember `#D4632E` and purple `#713A98`. They occupy different steps because they have different perceptual lightness. A step number is a position within one family, not a contrast guarantee between families.

The sRGB shade families live in `src/themes/brand.ts`, with semantic app assignments in `src/themes/default.ts`. Ember and purple have strictly decreasing Oklab lightness within each family; the spacing is authored rather than mathematically uniform. `/design-system#color` displays the families beside resolved light/dark app and shared gameplay colors.

| Step | Ember     | Mana purple |
| ---- | --------- | ----------- |
| 50   | `#FFF4EC` | `#F8F2FC`   |
| 100  | `#FDE5D3` | `#EFE3F7`   |
| 200  | `#FAC8A5` | `#DFC6ED`   |
| 300  | `#F4A474` | `#CDA8E3`   |
| 400  | `#EC8650` | `#BD91D9`   |
| 500  | `#E7753C` | `#A56BC4`   |
| 600  | `#D4632E` | `#8C50AF`   |
| 700  | `#AD4822` | `#713A98`   |
| 800  | `#88391F` | `#5A3077`   |
| 900  | `#6D301D` | `#48295D`   |
| 950  | `#3B170E` | `#2D183D`   |

Do not turn these shade families into selectable themes. They are ingredients for one identity, used through semantic tokens.

### Sage is a supporting accent

| Shade     | Value     | Role                                   |
| --------- | --------- | -------------------------------------- |
| Mist      | `#E9EEE5` | Quiet light-mode decorative background |
| Sage      | `#9BAF91` | Dark-mode decorative ink               |
| Deep sage | `#52664B` | Light-mode decorative ink              |

Use `brand-accent` for small non-interactive details, `brand-accent-muted` for their occasional background, and `brand-accent-foreground` for readable ink on that background. The dark sage background is `#303B2D`. Sage appears in the entry divider and sparse website details; it is not a third action color, focus cue, success signal or green-mana replacement. The shared shadcn `accent` remains neutral because menus and hover states consume it throughout the app.

### Supporting neutrals

| Name        | Value     | Role                                            |
| ----------- | --------- | ----------------------------------------------- |
| Soot        | `#1C191D` | Dark page background; dark text on bright fills |
| Cauldron    | `#272329` | Dark cards and panels                           |
| Ash         | `#342E37` | Raised dark panels and quiet separators         |
| Steam       | `#F4EEE8` | Main dark-mode text; light page background      |
| Pewter      | `#B9AEBB` | Secondary dark-mode text                        |
| Dark pewter | `#655B69` | Secondary light-mode text                       |

The slight plum bias ties the neutrals to mana purple without making the whole application purple. Steam is an off-white for reading, not a parchment texture.

### Roles before decoration

- Ember owns the action that advances the current decision. Ordinary utilities remain neutral.
- Purple owns selected controls and mana-related brand illustration. Selection also needs a check, border, or other shape cue.
- Keyboard focus remains an explicit semantic role, distinct from selection. Use a contrast-checked ring with separation from the control fill.
- Large backgrounds remain neutral. Purple panels should be exceptional, not the default container treatment.
- Do not split the wordmark into orange "Mana" and purple "brew" by default. Keep the name one readable unit and put the contrasting color in the brew.
- Keep rules-significant colors independent. Mana symbols, targeting, damage, poison, player identities and errors must not be recolored into two brand hues. Preserve established meanings and pair color with labels or symbols.
- Keep success and error colors functional rather than adding a third and fourth dominant brand color.

### Implemented light and dark assignments

Dark-mode primary uses Ember 400 so existing ember-colored labels also remain readable on Ash panels. Light-mode muted and neutral hover backgrounds use `#F0E9EF`, which preserves readable Ember 700 text.

| Role                      | Dark mode                                              | Light mode                                             |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Page / text               | Soot / Steam                                           | Steam / Soot                                           |
| Header / text             | Cauldron / Steam                                       | White / Soot                                           |
| Panel                     | Cauldron                                               | White                                                  |
| Secondary text            | Pewter                                                 | Dark pewter                                            |
| Primary fill / text       | Ember 400 / Soot                                       | Ember 700 / White                                      |
| Primary hover fill / text | Ember 300 / Soot                                       | Ember 800 / White                                      |
| Purple text or icon       | Mana 400                                               | Mana 700                                               |
| Selected fill / text      | Mana 950 / Mana 200, with a visible Mana 400 indicator | Mana 100 / Mana 800, with a visible Mana 700 indicator |
| Sage detail               | Sage / Soot                                            | Deep sage / Steam                                      |

The logo can retain the anchor colors while controls use neighboring shades for contrast. Light and dark modes are lighting conditions for the same brand, not separate identities.

Navigation headers reuse the same `card` surface as the hero cards. Dark mode uses the approved white-cauldron artwork against that surface; light mode keeps the original dark cauldron. SVG backgrounds remain transparent, without a separate header palette, a light panel, or CSS recoloring.

### Measured contrast

Calculated using WCAG relative luminance on the exact opaque sRGB pairs below. Values are rounded for display; pass decisions use unrounded results. These checks do not establish whole-app accessibility and do not cover translucent overlays or unknown card-art backgrounds.

| Foreground / background |   Ratio | Ordinary text AA     |
| ----------------------- | ------: | -------------------- |
| Soot / Ember 600        |  4.66:1 | Pass, limited margin |
| White / Ember 600       |  3.73:1 | Fail                 |
| Soot / Ember 500        |  5.81:1 | Pass                 |
| Soot / Ember 400        |  6.71:1 | Pass                 |
| White / Ember 700       |  5.63:1 | Pass                 |
| White / Ember 800       |  7.92:1 | Pass                 |
| Steam / Mana 700        |  6.61:1 | Pass                 |
| Mana 700 / Soot         |  2.29:1 | Fail                 |
| Mana 400 / Ash          |  5.16:1 | Pass                 |
| Pewter / Ash            |  6.18:1 | Pass                 |
| Soot / Steam            | 15.12:1 | Pass                 |
| Dark pewter / Steam     |  5.61:1 | Pass                 |
| Soot / Ember 300        |  8.63:1 | Pass                 |
| Ember 400 / Ash         |  5.08:1 | Pass                 |
| Ember 700 / light muted |  4.72:1 | Pass                 |
| Sage / Soot             |  7.41:1 | Pass                 |
| Deep sage / Steam       |  5.43:1 | Pass                 |
| Deep sage / Mist        |  5.30:1 | Pass                 |

WCAG AA requires 4.5:1 for ordinary text and 3:1 for large text. Required visual information identifying controls and their states generally needs 3:1 against adjacent colors. A dark purple that works as a fill with pale text does not automatically work as purple text on a dark panel.

For further shade tuning, use Oklch to control perceived lightness and chroma, constrain the result to sRGB for consistent DOM/canvas rendering, and measure the final foreground/background pair. Oklch alone does not guarantee WCAG contrast.

## Typography

Alegreya Sans Bold 700 supplies brand text and display headings; Source Sans 3 supplies the interface and game data. Both families are bundled locally. CSS and imperative stacks are defined in `src/index.css` and `src/themes/typography.ts`.

### Alegreya Sans connects the wordmark and display text

Use the normal Bold face at weight 700 for onboarding titles, marketing headlines and display headings. Keep card rules, deck rows, small navigation, mana counts and dense tables in their existing fonts.

The approved wordmark uses outlined Alegreya Sans vector paths, independent of installed fonts. The balanced horizontal lockup retains its 1080 × 400 canvas, with a larger wordmark beside a smaller Brewy. Preserve its letter spacing and scale the complete lockup proportionally instead of stretching it.

### Source Sans 3 keeps the game readable

Paul D. Hunt designed Adobe's Source Sans as an open-source family for user interfaces. Its humanist construction gives a quieter companion to the brush-lettered display face.

Use lining tabular figures for changing life totals, timers, quantities and comparable statistics. Use proportional figures in prose. Imperative UI text uses Source Sans 3; native Card Glint printing and physical-card font registration remain independent.

The application waits for normal/italic UI and display font loading before mounting React so successful loads are available for first-frame canvas measurements. Failed font downloads retain the declared system-font fallback rather than blocking startup. Existing game and Limited UI retain their layout roles while sharing the same readable family. A system monospace remains only for code, diagnostics and explicit utility labels.

### Distribution

Alegreya Sans and Source Sans 3 use SIL Open Font License 1.1. Their WOFF2 files are bundled locally, without runtime font-CDN requests. Full copyright and OFL notices ship in `public/font-licenses/` for the app and `website/public/fonts/` for the sites. If redistributing modified font files, follow the font's reserved-name provisions where applicable.

## One parent mascot, contextual children

Draw the parent as a squat, slightly asymmetric pot with a clear open rim, small feet and a lopsided brewing gesture. It should read as a cauldron in one flat color before any eyes, bubbles or flame are added. Make the silhouette funny through proportion and posture; facial details should not be the only source of personality.

Keep the body proportions, rim, feet and main negative spaces consistent across variants. Change the pose, brew level, bubbles or one prop. Do not give every screen a different character design.

| Context            | Variant                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| Main identity      | Parent cauldron with a recognizable single bubble arrangement                  |
| Deck building      | Same cauldron stirring with a card-shaped ingredient                           |
| Loading            | Same cauldron with a small bubble cycle; static alternative for reduced motion |
| Empty collection   | Same cauldron with an empty interior and one waiting bubble                    |
| Connection failure | Same cauldron with a stalled brew; explicit error and recovery text beside it  |
| Completed action   | Same cauldron with a small satisfied puff, without obscuring the result        |

Keep variants out of dense gameplay decisions. An opponent disconnecting or a failed save needs clear information, not a joke at the player's expense. Illustrations must not imply a determinate amount of progress unless they actually represent it.

### Logo family

The primary lockup includes both the cauldron and the complete name `Manabrew`. Use it in introductions, the website header, launch materials and prominent product identification.

The symbol-only icon identifies app launchers, favicons and constrained navigation. "Always include the name" is a good rule for introducing the brand, but not for a 16-pixel favicon. Give standalone interactive icons an accessible name in the interface.

Draw full-color, single-color and reversed versions. The single-color version must preserve the rim and body separation without gradients, glow or color-dependent detail. Make a simplified micro-icon rather than shrinking every detail of the full mascot.

For artwork revisions, compare the icon at 16, 24, 32 and 64 pixels, inspect the wordmark at header size, and check a one-color print. Keep header SVG backgrounds transparent; do not add a light panel to compensate for dark-mode contrast. Browser icons use the separately approved favicon tile.

## Designer reference PDF

Open `/design-system` and choose **Export PDF**, then **Save as PDF** in the browser's print dialog. Export waits for fonts, card examples and images. The A4 document includes collapsed sections, both light/dark token tables, typography, icons, component examples, all three card-face styles, spacing and assets.

Component examples use the current light/dark mode and include personal color overrides. The cover records the mode and export date. To share both treatments, export once in each mode; the action does not change theme preferences.

## Implementation boundaries

Existing personal color overrides are preserved. Reset Colors restores the new canonical defaults for that mode; game overrides remain shared. Primary hover has an explicit paired fill. Selected backgrounds, foregrounds and purple borders are separate tokens; selection text and rings do not reuse the tinted fill.

Utility pages no longer have the brewery illustration behind them. The existing illustration remains on entry and home hero surfaces and the website, without inventing new mascot artwork. App headers use the horizontal SVG on wider screens and the symbol on compact screens. Website headers use the horizontal SVG without duplicate text.

Designer source artwork and unused exports live outside the repository. Run `python3 scripts/generate-brand-logo.py /path/to/manabrew-brand` after changing approved exports. It uses the latest dark horizontal export's balanced geometry for both modes, applying the light export's approved inks for light mode. Standalone symbol variants come from their dark/light exports. It writes complete static groups to `images/brand/logos/interactive/manabrew-logo.svg` and dimensions to `src/assets/brandLogoGeometry.json`. Liquid and eyes remain transparent body cutouts. All app routes and website headers share these outputs; no route-specific preview remains. Normal builds consume the committed runtime outputs without Python or the external archive.

The app follows resolved light/dark mode and theme previews; documentation follows its selected theme. Every browser and native app icon uses the Brewy-only `favicon/` artwork with the same purple background. SVG and ICO favicons are copied unchanged into app and website public directories; browser PNGs, the 512px Apple touch icon and PWA icons are resized from the supplied PNG. PWA icons use `purpose: "any"`, not `maskable`. Generate desktop and mobile icons from that same PNG, retaining desktop tile-corner transparency, matching Android adaptive backgrounds to `#48295d`, and saving iOS icons as opaque RGB on that purple. Refresh canonical Android mirrors and initialized mobile launcher resources. Keep these shipped icons in the repository. Retain existing illustrations, including `website/public/cauldronColored.png`.

### Static logo behavior

The logo artwork stays still on hover, keyboard focus and touch. Navigation controls retain ordinary hover/focus affordances, but no mouth/fire reaction, bubble movement, pointer listeners or gallery reaction toggle remains. Favicons and native icons are static too.

### Brewing-room illustration assets

The external brand folder's `illustrations/manabrew-brewing-room-desktop.*` supplies a 2560 × 1440 landscape composition with copy space on the left. `manabrew-brewing-room-mobile.*` supplies a separately composed 1080 × 1920 portrait with copy space above the cauldron. Both use the canonical full mascot, ember heat, purple brew, and restrained sage ingredients, without baked-in text or a wordmark.

Each composition includes an editable `.vectorcraft` master and SVG, plus a `.pcraft` finishing master with an embedded render, nondestructive grain, and a curves adjustment. PNG exports are lossless; WebP exports use quality 90. These unused assets remain outside the repository. Existing app and website background references remain unchanged.

## Research sources

- [Alegreya Sans specimen, Google Fonts](https://fonts.google.com/specimen/Alegreya+Sans).
- [Alegreya Sans source and licensing](https://github.com/huertatipografica/Alegreya-Sans).
- [Source Sans 3, Adobe Fonts](https://fonts.adobe.com/fonts/source-sans-3).
- [Source Sans source, releases and licensing, Adobe](https://github.com/adobe-fonts/source-sans).
- [Bricolage Grotesque design notes, Mathieu Triay](https://ateliertriay.github.io/bricolage/).
- [Newsreader, Production Type](https://github.com/productiontype/Newsreader).
- [Oklab and perceptual lightness, Björn Ottosson](https://bottosson.github.io/posts/oklab/).
- [WCAG 2.2 text contrast guidance, W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- [WCAG 2.2 non-text contrast guidance, W3C](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
