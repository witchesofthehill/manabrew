# UI theme rules

**All colors must be theme-driven.** No hex / rgb / rgba / hsl / `0xRRGGBB` literals in component or Pixi code. Every color the user sees flows through the theme pipeline.

This file is a quick reference. The canonical write-up is `docs/STYLE_GUIDELINES.md` §9 — read it for the full pipeline diagram and rationale.

## The pipeline

```
BasePalette (~30 raw hues per preset)
  → buildGameColors(palette): GameThemeColorMap  (~80 semantic tokens)
    → resolveGameThemeColors(): default → active preset → user overrides
      → flatToGameTheme(): nested GameThemeColors object
        → flattenGameThemeToCssVars(): --kebab-case CSS vars on :root
          → @theme block in src/index.css → Tailwind utilities
```

## Where colors live

| File                             | Role                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/themes/gameTheme.ts`        | `GameThemeColors` interface, `GameThemeColorKey` union, `GameThemeColorMap`, resolution logic, CSS flattening, color utilities. Source of truth for the schema. |
| `src/themes/buildGameColors.ts`  | `BasePalette` interface, `buildGameColors()` — maps ~30 raw hues to ~80 typed tokens.                                                                           |
| `src/themes/default.ts`          | Default palette + preset (the fallback for every token).                                                                                                        |
| `src/themes/<name>.ts`           | Per-preset palette overrides (nord, dracula, catppuccin, …). 12 presets total.                                                                                  |
| `src/themes/presets.ts`          | `ThemePreset` interface and registry.                                                                                                                           |
| `src/hooks/useTheme.ts`          | `useTheme()` (React), `getTheme()` (imperative — for Pixi), CSS var injection.                                                                                  |
| `src/index.css`                  | The `@theme` block mapping CSS vars to Tailwind utilities — **auto-generated**.                                                                                 |
| `scripts/generate-theme-css.mjs` | Regenerates the `@theme` block. Run with `--write` after schema changes.                                                                                        |

## Type safety

`GameThemeColorKey` is a compile-time union of every dot-notation path through `GameThemeColors`, derived via `FlatPaths<T>`. This means:

- A typo in `buildGameColors()` (`pointer.hostlie`) → compile error.
- A missing key in `buildGameColors()` → compile error.
- An extra key not declared in `GameThemeColors` → compile error.

Trust the type system. You don't need defensive checks at the consumer.

## Rules

1. **No `#RRGGBB`, `rgba(…)`, `hsl(…)`, or `0xRRGGBB` literals** in source files. Pull every color from the theme.
2. **No tailwind palette classes** (`ring-red-500`, `bg-blue-400`, `text-amber-300`). Use the theme-token utilities: `bg-pointer-hostile`, `text-counter-p1p1`, `ring-card-ring`, `bg-pt-buffed`, `text-format-badge-blue`, `text-legality-legal`. Every key in `GameThemeColors` has matching `bg-*` / `text-*` / `ring-*` / `border-*` utilities via the `@theme` block.
3. **No fallbacks in components or Pixi layers.** The resolution chain guarantees every token is a non-empty string. Never write `theme.pointer.hostile ?? "#ff0000"` or `safeColor(raw, fallback)`.
4. **Pixi reads theme directly** via `getTheme().gameTheme.*` or the `theme` field set by `setTheme()`. No optional chaining, no adapter. (The old `src/pixi/themeAdapter.ts` is gone.)
5. **Conditional classes use `cn()`**, never template literals. Static strings only — Tailwind's JIT cannot detect `bg-${color}-400`.

### Single narrow exception

Pure `rgba(0, 0, 0, X)` shadow idioms in tailwind arbitrary classes (`shadow-[0_10px_30px_rgba(0,0,0,0.35)]`) are allowed when the shadow is intentionally physics-black. Any colored shadow goes through the theme.

The previous identity-palette exceptions for `FormatBadge.tsx` and `DeckVsSelector.tsx` no longer exist — those colors are now real theme tokens (`format-badge-*`, slot-assignment keys). New code should not claim a similar exception; add a semantic key instead.

## Adding a new color

1. Add the field to `GameThemeColors` in `src/themes/gameTheme.ts`.
2. Add the mapping in `buildGameColors()` in `src/themes/buildGameColors.ts` (map a `BasePalette` hue to the new token). If a new base hue is needed, add it to the `BasePalette` interface and to every preset file.
3. Run `node scripts/generate-theme-css.mjs --write` to regenerate the `@theme` block in `src/index.css`.
4. The new token is immediately available as a Tailwind utility (`bg-my-new-token`) and via `useTheme().gameTheme.myNewToken`. All 12 presets get a value automatically via `buildGameColors`.

If you find yourself about to type a hex literal, stop and add a semantic theme key.

## Canonical constants

| Constant            | Location                           | Use                                               |
| ------------------- | ---------------------------------- | ------------------------------------------------- |
| `MANA_LETTERS`      | `src/themes/gameTheme.ts`          | `["W","U","B","R","G","C"]` — never re-declare    |
| `ANY_COLOR_LETTERS` | `src/components/game/manaUtils.ts` | `["W","U","B","R","G"]` — WUBRG without colorless |
