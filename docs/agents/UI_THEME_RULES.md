# UI theme rules

**All colors must be theme-driven.** No hex / rgb / rgba / hsl / `0xRRGGBB` literals in component or Pixi code. Every color the user sees flows through the theme pipeline.

This file is a quick reference. The canonical write-up is `docs/STYLE_GUIDELINES.md` §9 — read it for the full pipeline diagram and rationale.

## The pipeline

```
BasePalette (Manabrew raw hues)
  → buildGameColors(palette): GameThemeColorMap  (~80 semantic tokens)
    → resolveGameThemeColors(): Manabrew defaults → user overrides
      → flatToGameTheme(): nested GameThemeColors object
        → flattenGameThemeToCssVars(): --kebab-case CSS vars on :root
          → @theme block in src/index.css → Tailwind utilities
```

## Where colors live

| File                             | Role                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/themes/gameTheme.ts`        | `GameThemeColors` interface, `GameThemeColorKey` union, `GameThemeColorMap`, resolution logic, CSS flattening, color utilities. Source of truth for the schema. |
| `src/themes/buildGameColors.ts`  | `BasePalette` interface, `buildGameColors()` — maps ~30 raw hues to ~80 typed tokens.                                                                           |
| `src/themes/default.ts`          | Canonical Manabrew light/dark colors, game palette, and game font sizes                                                                                         |
| `src/themes/brand.ts`            | Ember/purple shade families, restrained sage accents, and warm neutrals shared with the website.                                                                |
| `src/themes/typography.ts`       | Source Sans 3 UI and Alegreya Sans display stacks for imperative text.                                                                                          |
| `src/hooks/useTheme.ts`          | Shared resolved snapshot: `useTheme()` for React, `getTheme()` / `subscribeTheme()` for Pixi, and root-only `useApplyTheme()`.                                  |
| `src/index.css`                  | The `@theme` block mapping CSS vars to Tailwind utilities — **auto-generated**.                                                                                 |
| `scripts/generate-theme-css.mjs` | Regenerates the `@theme` block. Run with `--write` after schema changes.                                                                                        |
| `src/themes/themeColor.ts`       | Dependency-free color parsing, alpha compositing, and contrast math; re-exported by `gameTheme.ts`.                                                             |
| `src/themes/themeDocument.ts`    | Version 2 Manabrew theme documents and validated version 1 imports. See `docs/STYLE_GUIDELINES.md` §9 for migration rules.                                      |
| `src/themes/themeMetadata.ts`    | Shared semantic labels, descriptions, and editor groups used by Settings and `/card-mock`.                                                                      |

## Type safety

`GameThemeColorKey` is a compile-time union of every dot-notation path through `GameThemeColors`, derived via `FlatPaths<T>`. This means:

- A typo in `buildGameColors()` (`pointer.hostlie`) → compile error.
- A missing key in `buildGameColors()` → compile error.
- An extra key not declared in `GameThemeColors` → compile error.

Trust the type system. You don't need defensive checks at the consumer.

## Rules

1. **No `#RRGGBB`, `rgba(…)`, `hsl(…)`, or `0xRRGGBB` literals** in source files. Pull every color from the theme.
2. **No tailwind palette classes** (`ring-red-500`, `bg-blue-400`, `text-amber-300`). Use the theme-token utilities: `bg-targeting-hostile`, `text-counter-p1p1`, `ring-card-ring`, `bg-pt-buffed`, `text-format-badge-blue`, `text-legality-legal`. Every key in `GameThemeColors` has matching `bg-*` / `text-*` / `ring-*` / `border-*` utilities via the `@theme` block.
3. **No fallbacks in components or Pixi layers.** The resolution chain guarantees every token is a non-empty string. Never write `theme.targeting.hostile ?? "#ff0000"` or `safeColor(raw, fallback)`.
4. **Pixi reads theme directly** via `getTheme().gameTheme.*` or the `theme` field set by `setTheme()`. No optional chaining, no adapter. (The old `src/pixi/themeAdapter.ts` is gone.)
5. **Preview without persistence.** `/card-mock` calls `setThemePreview(document)` for draft changes and clears it on unmount. Save applies a theme document atomically. App overrides are mode-scoped; old flat overrides migrate into both modes. Gameplay chrome follows the selected app mode. Light phase strips inherit app `card`; loading-card fills and strokes inherit app `muted` and `border`. Shared personal game overrides take precedence. Battlefield artwork, printing, mana, targeting, damage, and player identity retain their game palettes.
6. **Keep theme ownership explicit.** `ThemeApplicator` alone writes root CSS variables. Readers consume the shared snapshot; imperative canvases subscribe with `subscribeTheme`. Global Pixi styles mean two independently themed boards cannot be isolated with CSS wrappers alone.
7. **Pair foregrounds with fills.** Pass and priority actions use the app `primary` and `primary-foreground` tokens; attack, defense, and cancel use `promptAction.*` with `promptForeground.*`. Phase and placeholder labels choose readable ink against their resolved fill. Modal status ink is contrast-adjusted on neutral app surfaces. Use `cardRing` for battlefield availability/focus, `cardSelection` for persistent card selection, and `targeting.*` for target/attachment arrows. App-style choice controls use the app selection fill/foreground/border. Root game-token names must not collide with app CSS variables.
8. **Keep identity and action cues distinct.** Ember owns the advancing action, with paired `primary-foreground` and `primary-hover` values for each mode. Purple owns selection: use `selection` for the tinted fill, `selection-foreground` for ink on that fill, and `selection-border` for standalone selection text, borders and rings. Sage `brand-accent*` tokens are sparse non-interactive decoration, never action priority, focus, success or green mana. Shared `accent` and ordinary hover surfaces stay neutral. Focus rings, priority and game availability retain ember cues; player identity and rules-significant colors retain their own meanings. Text and icons on solid player-color fills use `readableTextColor`, not an assumed `textOnTinted` contrast. See `docs/BRAND_DIRECTION.md` for the full identity and pending logo specification.
9. **Conditional classes use `cn()`**, never template literals. Static strings only — Tailwind's JIT cannot detect `bg-${color}-400`.
10. **Live card changes use the invariant `cardChange.*` palette.** `CARD_CHANGE_COLORS` in `buildGameColors.ts` defines saturated, readable gain, loss, other-change and type-removal ink without glow or blur. Resolution keeps these values independent of personal overrides. They are reserved for native live-characteristic highlights, not ordinary badges or app chrome. `getGameThemeColorPaths()` and Settings defaults exclude this read-only family; CSS utilities still include it.
11. **Fallback card printing uses invariant `cardPrinting.*` colors.** These preserve the existing physical paper, ink, frame and footer colors after moving fallback painters into Manabrew. Like `cardChange.*`, they flow through the resolved theme but are excluded from editable Settings paths. Alpha/coverage masks encode data, not visible UI colors.

Table material pickers keep the dialog in the app palette and frame unchanged textures with `canvas.background`. Use `cardSelection` and `cardRing` for selection and focus against that dark frame. Table-centre content and seat captions need opaque app `background` backings paired with `foreground`, `muted-foreground`, or `primary`; app ink must not sit directly on table artwork.

### Single narrow exception

Pure `rgba(0, 0, 0, X)` shadow idioms in tailwind arbitrary classes (`shadow-[0_10px_30px_rgba(0,0,0,0.35)]`) are allowed when the shadow is intentionally physics-black. Any colored shadow goes through the theme.

The previous identity-palette exceptions for `FormatBadge.tsx` and `DeckVsSelector.tsx` no longer exist — those colors are now real theme tokens (`format-badge-*`, slot-assignment keys). New code should not claim a similar exception; add a semantic key instead.

## Adding a new color

1. Add the field to `GameThemeColors` in `src/themes/gameTheme.ts`.
2. Add the mapping in `buildGameColors()` in `src/themes/buildGameColors.ts` (map a `BasePalette` hue to the new token). If a new base hue is needed, add it to the `BasePalette` interface and the palette in `default.ts`.
3. Run `node scripts/generate-theme-css.mjs --write` to regenerate the `@theme` block in `src/index.css`.
4. The new token is immediately available as a Tailwind utility (`bg-my-new-token`) and via `useTheme().gameTheme.myNewToken`.

If you find yourself about to type a hex literal, stop and add a semantic theme key.

## Canonical constants

| Constant            | Location                           | Use                                               |
| ------------------- | ---------------------------------- | ------------------------------------------------- |
| `MANA_LETTERS`      | `src/themes/gameTheme.ts`          | `["W","U","B","R","G","C"]` — never re-declare    |
| `ANY_COLOR_LETTERS` | `src/components/game/manaUtils.ts` | `["W","U","B","R","G"]` — WUBRG without colorless |
