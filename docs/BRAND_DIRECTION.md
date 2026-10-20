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

Fraunces supplies brand text and occasional display headings; Source Sans 3 supplies the interface and game data. Both use locally bundled variable fonts. CSS and imperative stacks are defined in `src/index.css` and `src/themes/typography.ts`.

I also considered Bricolage Grotesque, whose French/British grotesque mixture offers a more contemporary, irregular wordmark, and Newsreader, which suggests a quieter reading-oriented product. Fraunces wins here because its soft, leaning forms can echo the cauldron's deliberate awkwardness. This is an aesthetic choice, not a legibility ranking.

### Fraunces gives the cauldron a typographic relative

Undercase Type's Phaedra Charles and Flavia Zimbardi designed Fraunces around the expressive soft-serif tradition of Windsor, Souvenir and Cooper. The designers explicitly describe the genre as playful and sometimes goofy. That is a closer fit to a derpy cauldron than a solemn fantasy inscription.

Fraunces includes weight, optical size, softness and wonk axes. Implemented display text uses weights 600/700, automatic optical sizing, softness 60 and wonk 1. The approved outlined wordmark uses Fraunces 700. Its geometry is enlarged relative to the cauldron so the name remains legible at header size.

The wordmark uses outlined vector paths with deliberate proportions, independent of installed fonts. Preserve its letter spacing when resizing; scale the lockup proportionally instead of stretching it.

Reserve Fraunces for the logo, onboarding titles, marketing headlines and occasional empty-state headings. Do not use it for card rules, deck rows, small navigation, mana counts or dense tables. Its optical sizing improves small-size behavior, but that is not a reason to use a decorative face everywhere.

### Source Sans 3 keeps the game readable

Paul D. Hunt designed Adobe's Source Sans as an open-source family for user interfaces. Its humanist construction gives a quieter companion to the expressive serif without making the entire product look like a children's game.

Use lining tabular figures for changing life totals, timers, quantities and comparable statistics. Use proportional figures in prose. Imperative UI text uses Source Sans 3; native Card Glint printing and physical-card font registration remain independent.

The application waits for normal/italic UI and display font loading before mounting React so successful loads are available for first-frame canvas measurements. Failed font downloads retain the declared system-font fallback rather than blocking startup. Existing game and Limited UI retain their layout roles while sharing the same readable family. A system monospace remains only for code, diagnostics and explicit utility labels. Alegreya Sans, Cormorant Garamond and Inter brand dependencies are removed.

### Distribution

Fraunces and Source Sans 3 use SIL Open Font License 1.1. Their WOFF2 files are bundled locally, without runtime font-CDN requests. Full copyright and OFL notices ship in `public/font-licenses/` for the app and `website/public/fonts/` for the sites. If redistributing modified font files, follow the font's reserved-name provisions where applicable.

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

## Implementation boundaries

Existing personal color overrides are preserved. Reset Colors restores the new canonical defaults for that mode; game overrides remain shared. Primary hover has an explicit paired fill. Selected backgrounds, foregrounds and purple borders are separate tokens; selection text and rings do not reuse the tinted fill.

Utility pages no longer have the brewery illustration behind them. The existing illustration remains on entry and home hero surfaces and the website, without inventing new mascot artwork. App headers use the horizontal SVG on wider screens and the symbol on compact screens. Website headers use the horizontal SVG without duplicate text.

Approved source artwork lives in `images/brand/logos/color/` and `images/brand/logos/dark/`, with mouth/fire and brew layers under `images/brand/layers/`. Run `python3 scripts/generate-brand-logo.py` after changing designer exports. It prepares `images/brand/logos/interactive/manabrew-logo.svg` and `src/assets/brandLogoGeometry.json` for the React and Astro renderers without modifying the original artwork. The horizontal 1450:400 viewBox retains the wordmark's 1.6-times enlargement. Keep generated outputs with source changes; normal builds consume them without Python.

The app follows resolved light/dark mode and theme previews; documentation follows its selected theme. Browser icons use the dedicated exports in `images/brand/favicon/`, preserving the supplied rounded tile and transparent corners in both color schemes. SVG and ICO are copied unchanged into the app and website public directories; PNG fallbacks, Apple touch and PWA icons come from the supplied 512px PNG. PWA icons use `purpose: "any"`, not `maskable`. Native desktop/Android icons preserve alpha; native iOS icons are flattened to opaque RGB because iOS requires it. Contextual screen illustrations remain outside this implementation.

### Interactive header logo

At rest, preserve the closed-mouth silhouette. Mouse or pen hover anywhere on the existing Home control, or keyboard-visible focus, reveals the mouth and clipped fire. Both flame layers flicker while the three brew bubbles and three floating bubbles/drops move with staggered timing. The body and wordmark stay fixed. Motion runs for roughly two seconds, then settles with the mouth open until hover/focus ends; leaving resets the reaction.

Reduced motion shows the static open-mouth/fire pose without animation or transitions. Touch navigation remains a single tap, without a hover-only first tap. `/design-system#assets` provides an explicit, keyboard- and touch-operable preview toggle; standalone specimens stay still. Each logo instance owns a unique mouth clip. Favicons and native icons remain static.

## Research sources

- [Fraunces specimen and design history, Undercase Type](https://fraunces.undercase.xyz/).
- [Fraunces source and licensing](https://github.com/undercasetype/Fraunces).
- [Source Sans 3, Adobe Fonts](https://fonts.adobe.com/fonts/source-sans-3).
- [Source Sans source, releases and licensing, Adobe](https://github.com/adobe-fonts/source-sans).
- [Bricolage Grotesque design notes, Mathieu Triay](https://ateliertriay.github.io/bricolage/).
- [Newsreader, Production Type](https://github.com/productiontype/Newsreader).
- [Oklab and perceptual lightness, Björn Ottosson](https://bottosson.github.io/posts/oklab/).
- [WCAG 2.2 text contrast guidance, W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- [WCAG 2.2 non-text contrast guidance, W3C](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
