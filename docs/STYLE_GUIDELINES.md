# UI Style Guidelines

This document defines coding conventions for all React/TypeScript UI code under `src/`.
Follow these rules when creating or modifying components.

---

## 1. File Organization

### Component files

- **One exported component per file.** Internal helpers (sub-components used only inside that file) are fine, but if they grow past ~30 lines, extract them.
- **Max ~200 lines per component file.** If a file grows larger, split it into focused sub-components.
- Files that contain 5+ modal variants (like `CostModal.tsx`) should be split into individual files or grouped in a subdirectory.

### Shared modules

| File                | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `game.types.ts`     | Shared TypeScript interfaces and type aliases                 |
| `game.constants.ts` | Magic numbers, phase definitions, color arrays, sizing values |
| `game.styles.ts`    | Reusable Tailwind class-string constants                      |
| `game.utils.ts`     | Pure utility functions (no React)                             |

When adding a new constant, type, or utility, check these files first — do not duplicate.

---

## 2. Tailwind Class Management

### Use named constants for repeated classes

If the same Tailwind string appears in **2+ files**, extract it to `game.styles.ts`:

```ts
// game.styles.ts
export const ZONE_LABEL =
  "text-ui-meta font-semibold text-muted-foreground uppercase tracking-wide px-1" as const;
```

```tsx
<span className={cn(ZONE_LABEL, "text-center")} />
```

### Always use `cn()` for conditional classes

Never use template literals for conditional Tailwind. Use `cn()` from `@/lib/utils`:

```tsx
// ✅ Good
className={cn("text-ui-label", isActive && "font-bold")}

// ❌ Bad
className={`text-ui-label ${isActive ? "font-bold" : ""}`}
```

### Never generate Tailwind classes dynamically

Tailwind's JIT compiler cannot detect dynamic class names. Always use full static strings:

```tsx
// ✅ Good
const ringClass = isSelected ? "ring-blue-400" : "ring-gray-300";

// ❌ Bad
const color = "blue";
className={`ring-${color}-400`}
```

### Card sizing constants

Use `GAME_CARD_SIZES` from `game.constants.ts`. These are the only base card dimensions:

| Size          | Value                               | Usage                                                                 |
| ------------- | ----------------------------------- | --------------------------------------------------------------------- |
| `battlefield` | `70 × 98`                           | Battlefield cards and zone tiles                                      |
| `hand`        | `130 × 182`                         | Hand cards and non-actionable zone browser cards                      |
| `prompt`      | `300√0.7 × 420√0.7` (`≈251 × ≈351`) | Choice cards rendered inside prompts; exactly 70% of the preview area |
| `preview`     | `300 × 420`                         | Source cards, actionable zones, stack, command zone, hover previews   |

Responsive layout may scale a base size to fit available space. Do not add a context-specific card size without a distinct semantic role.

## 3. Component Patterns

### Modal structure

All game modals should use the `Modal` compound component:

```tsx
<Modal onClose={onCancel} maxWidth="max-w-md">
  <Modal.Header>
    <h2 className={MODAL_TITLE}>Title</h2>
  </Modal.Header>
  <Modal.Instructions>Instruction text</Modal.Instructions>
  <Modal.Body>{/* content */}</Modal.Body>
  <Modal.Footer>{/* buttons */}</Modal.Footer>
</Modal>
```

- Use `MODAL_CARD_THUMBNAIL` for small card images in headers.
- Use `MODAL_CARD_IMAGE` for larger card images in bodies.
- Use `MODAL_FOOTER_BETWEEN` for footers with left info + right buttons.

### Button hierarchy

Every `Button` must declare a `variant`. High emphasis is never an implicit default.

- `primary`: the single action that advances or completes the current decision. Use at most one per visible action group.
- `secondary`: a visible but deliberately less-preferred alternative to the primary action.
- `outline`: ordinary utilities and equivalent alternatives such as import, export, copy, edit, and retry.
- `ghost`: dismissal, back navigation, clearing, and compact toolbar actions.
- `destructive-quiet`: an entry point to a destructive flow. Reserve solid red for the confirmation step.
- `destructive`: the final irreversible confirmation, such as delete, concede, or leave.
- `selected`: persistent selection or toggle state. Selection is state, not action priority.
- `link`: inline text navigation only.

Filled buttons answer “what should I do now?” Neutral outlines answer “what else can I do?” Multiple equal choices use outline or selected treatments rather than several primary buttons.

Modal footers use ghost for Cancel, Close, Back, and auto-applied Done actions; primary for a commit action; destructive for the final irreversible confirmation.

### Card image in modal headers

When showing a source card thumbnail alongside a modal title:

```tsx
<Modal.Header>
  <div className="flex items-center gap-3">
    {imageUrl && (
      <CardImageThumbnail imageUrl={imageUrl} cardName={name} className={MODAL_CARD_THUMBNAIL} />
    )}
    <div>
      <h2 className="font-semibold text-base">Title</h2>
      <p className="text-ui-meta text-muted-foreground">{subtitle}</p>
    </div>
  </div>
</Modal.Header>
```

### Mana text rendering

Use `DynamicTextRender` for React text that may contain `{W}`, `{2}{R}`, etc. Pixi text uses `PixiRichText`, which shares the mana-symbol texture cache.

```tsx
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
<DynamicTextRender text={description} />;
```

---

## 4. Custom Hooks

### Extract repeated stateful logic into hooks

If 2+ components share the same `useState` + `useEffect` pattern, extract a custom hook:

- **`useModalKeyboard(handlers)`** — for Enter/Escape key handling in modals
- **`useCardSelection(options)`** — for toggle-to-select card sets with min/max constraints
- **`useCardPreview(dismissDeps)`** — unified mouse hover → card preview pattern with sticky & action support
- **`HoverCardPreview`** — standard component to render the preview portal

### Hook file naming

Place hooks in `src/hooks/` if they're app-wide, or co-locate as `useXxx.ts` next to the component if they're component-specific.

---

## 5. Types

### Import types with `type` keyword

Always use `import type` for type-only imports:

```tsx
// ✅ Good
import type { Card as CardType } from "@/types/manabrew";

// ❌ Bad
import { Card as CardType } from "@/types/manabrew";
```

### Props interfaces

- Define props interfaces inline if the component is the only consumer.
- Move to `game.types.ts` if 2+ files reference the same interface.
- Name them `ComponentNameProps` (e.g., `PlayerPanelProps`).

---

## 6. State Management

### Keep state close to where it's used

Don't hoist state to Game.tsx unless multiple sibling components need it. Prefer local `useState` inside the component that owns the behavior.

### Zustand store (`useGameStore`)

Only store data that needs to persist across component unmounts or be accessed from non-React code. UI-only state (hover, modal open, panel collapsed) stays local.

---

## 7. Avoid Over-Engineering

- Don't create abstractions for one-time patterns. Three similar lines are better than a premature abstraction.
- Don't add error boundaries, loading skeletons, or fallback UI unless the user requests it.
- Don't add comments to self-explanatory code. Only comment _why_, not _what_.
- Don't add `aria-*` attributes speculatively — add them when accessibility is specifically requested.

---

## 8. Imports

### Order

1. React / third-party libraries
2. UI components (`@/components/ui/`)
3. Game components (`@/components/game/`)
4. Shared game modules (`./game.types`, `./game.styles`, etc.)
5. Hooks, stores, utils
6. Types (with `import type`)

### Path aliases

Always use `@/` path aliases. Never use `../../` relative paths that escape the current directory.

---

## 9. Theme System

**All colours must be theme-driven.** No hex / rgb / rgba / hsl
literals anywhere in component or Pixi code. Every colour the user sees
comes from shared semantic colors and the canonical Manabrew theme in `src/themes/`.
All colors flow through the resolution pipeline.

### Architecture overview

```
BasePalette (Manabrew raw hues)
  → buildGameColors(palette): GameThemeColorMap  (~80 semantic tokens)
    → resolveGameThemeColors():  Manabrew defaults → user overrides
      → flatToGameTheme():       nested GameThemeColors object
        → flattenGameThemeToCssVars():  --kebab-case CSS vars on :root
          → Tailwind @theme block:       bg-targeting-hostile, text-mana-w, …
```

| Surface                   | Source of truth                                                               | Accessor                                                       |
| ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| App chrome (Radix/shadcn) | `MANABREW_THEME.light` / `.dark` with mode-scoped overrides                   | `useTheme()`                                                   |
| Game board / Pixi canvas  | `MANABREW_THEME.gameColors`, mode-aware neutral chrome, then shared overrides | `useTheme().gameTheme` (React) / `getTheme().gameTheme` (Pixi) |

Gameplay app surfaces follow the selected light/dark mode. Light phase strips inherit
the resolved app card surface, and loading-card fills/strokes inherit muted/border;
shared personal game overrides are applied last. Pair labels with the actual fill.
Battlefield artwork, native card printing, mana, targeting, damage and player
identities keep their game palettes. Battlefield availability/focus uses `cardRing`,
not the darker light-mode app primary ink. `getDefaultGameThemeColorMap(mode)`
supplies the same inherited values to editors.

Native live-card highlights use the fixed `cardChange.*` family from
`CARD_CHANGE_COLORS` in `buildGameColors.ts`. Its readable saturated hues
ignore personal overrides, without glow or blur. These tokens flow
through the resolved game theme and generated CSS, but are excluded from
editable color paths and Settings defaults. Reserve them for changed card text.

### Where colours live

| File                            | Role                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/themes/gameTheme.ts`       | `GameThemeColors` interface, `GameThemeColorKey` union type, `GameThemeColorMap` typed record, resolution logic, CSS flattening, colour utilities |
| `src/themes/buildGameColors.ts` | `BasePalette` interface, `buildGameColors()` that maps ~30 hues → 80 typed tokens                                                                 |
| `src/themes/default.ts`         | Canonical Manabrew light/dark colors, game palette, and game font sizes                                                                           |
| `src/themes/brand.ts`           | Shared ember/purple shade families, sage details, and warm neutrals.                                                                              |
| `src/themes/typography.ts`      | UI/display font stacks and cached CSS typography metrics for imperative canvas text.                                                              |
| `src/hooks/useTheme.ts`         | Shared resolved snapshot for React/CSS/Pixi; root-only CSS application and transient editor preview                                               |
| `src/index.css`                 | Generated color mappings plus hand-maintained semantic typography and touch rules.                                                                |
| `src/themes/themeColor.ts`      | Shared parsing, compositing, and contrast math                                                                                                    |
| `src/themes/themeDocument.ts`   | Version 2 Manabrew theme documents, mode-scoped app overrides, and validated imports                                                              |
| `src/themes/themeMetadata.ts`   | Semantic labels and groups shared by Settings and the `/card-mock` editor                                                                         |

Manabrew has one base theme, with light, dark, and system mode preferences.
Settings and `/card-mock` edit personal app and game colors without changing that base.
The editor previews drafts without persistence; Save applies all overrides atomically.

Theme JSON exports use version 2 with `base: "manabrew"` and no preset selection.
Version 1 imports with `presetId: "default"` migrate to version 2. Imports based on
removed presets fail explicitly rather than silently changing their inherited colors.
Version 2 imports require the Manabrew base and reject a `presetId` field.
Preferences version 6 drops stored preset selection and migrates older AI choices to Forge.
Personal names, color overrides and unrelated settings survive; legacy flat app
overrides still migrate to both modes.

### Brand and typography

Follow `docs/BRAND_DIRECTION.md` for identity changes. Source Sans 3 is the UI/game
family; Alegreya Sans Bold 700 supplies brand text and display headings.
Keep native Card Glint printing fonts independent. Brand fonts load locally before
React mounts so canvas text is measured with the intended face.

Ember actions use explicit `primary-hover` and `primary-foreground` pairs.
Selection fill, text and purple indicators use `selection`, `selection-foreground`
and `selection-border` respectively. Sage uses `brand-accent*` only for sparse,
non-interactive details; shadcn `accent` remains neutral. Keep `accent` visibly
distinct from `popover` in both modes so menu hover and keyboard focus remain
visible. Existing personal color overrides survive the rebrand. Do not restore
invalid HSL-triplet defaults in CSS: `ThemeApplicator` owns resolved root colors
and the browser theme-color metadata.

### Type safety

The `GameThemeColorMap` type is a `Record<GameThemeColorKey, string>`
where `GameThemeColorKey` is a compile-time union of every valid
dot-notation path (derived from `GameThemeColors` via `FlatPaths<T>`).
This means:

- A **typo** in `buildGameColors()` (e.g. `"pointer.hostlie"`) → compile error
- A **missing key** in `buildGameColors()` → compile error
- An **extra key** not in `GameThemeColors` → compile error

### Rules

1. **No `#RRGGBB`, `rgba(…)`, `hsl(…)`, or `0xRRGGBB` literals in
   source files.** Pull every colour from the theme.
2. **No Tailwind palette classes** (e.g. `ring-red-500`, `bg-blue-400`).
   Use theme-token utilities instead: `bg-targeting-hostile`,
   `text-counter-p1p1`, `ring-card-ring`, `bg-pt-buffed`,
   `text-format-badge-blue`, `text-legality-legal`, etc. Every key in
   `GameThemeColors` has matching `bg-*` / `text-*` / `ring-*` /
   `border-*` utilities via the `@theme` block in `src/index.css`.
3. **No colour fallbacks in components or Pixi layers.** The resolution
   chain guarantees every token is a non-empty string. Never write
   `theme.targeting.hostile ?? "#ff0000"` or `safeColor(raw, fallback)`.
4. **Pixi code reads theme directly** via `getTheme().gameTheme.*` or
   the `theme` field set by `setTheme()`. No optional chaining needed.
5. **The one narrow exception**: pure `rgba(0, 0, 0, X)` shadow idioms
   in Tailwind arbitrary classes (`shadow-[0_10px_30px_rgba(0,0,0,0.35)]`)
   are allowed when the shadow is intentionally physics-black.

### When introducing a new colour

1. Add the field to `GameThemeColors` in `src/themes/gameTheme.ts`.
2. Add the mapping in `buildGameColors()` in `src/themes/buildGameColors.ts`
   (maps a `BasePalette` hue to the new token). If a new base hue is
   needed, add it to the `BasePalette` interface and the palette in `default.ts`.
3. Run `node scripts/generate-theme-css.mjs --write` to regenerate the
   `@theme` CSS block in `src/index.css`.
4. The new token is immediately available as a Tailwind utility
   (e.g. `bg-my-new-token`) and via `useTheme().gameTheme.myNewToken`.

If you find yourself about to type a hex literal in a component, stop
and add a semantic theme key instead.

### Canonical constants

| Constant            | Location                           | Purpose                                                        |
| ------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `MANA_LETTERS`      | `src/themes/gameTheme.ts`          | `["W","U","B","R","G","C"]` — use everywhere, never re-declare |
| `ANY_COLOR_LETTERS` | `src/components/game/manaUtils.ts` | `["W","U","B","R","G"]` — WUBRG without colorless              |

---

## 10. Naming Conventions

| Entity              | Convention              | Example               |
| ------------------- | ----------------------- | --------------------- |
| Component files     | PascalCase              | `PlayerPanel.tsx`     |
| Shared module files | camelCase               | `game.styles.ts`      |
| Hook files          | camelCase, `use` prefix | `useCardSelection.ts` |
| Style constants     | UPPER_SNAKE_CASE        | `ZONE_LABEL`          |
| Type/Interface      | PascalCase              | `CombatAssignment`    |
| Utility functions   | camelCase               | `getPromptLabel`      |

---

## 11. Responsive & Touch

Available width determines columns and panels. Available height determines compact chrome and scrolling. Touch capability determines readable controls; a wide tablet is not a mouse-only desktop.

- **Shared capability queries.** `src/lib/responsive.ts` owns `DESKTOP_QUERY`, `SHORT_SCREEN_QUERY`, `COARSE_POINTER_QUERY`, `TOUCH_CAPABLE_QUERY`, `MOBILE_GAME_QUERY`, and long-press timings. Use `useHasTouchPointer` and the `touch:` variant for sizing on any touch-capable device, including one with an attached mouse. Primary-pointer interaction stays separate. In-game scene selection still uses `useIsMobileGame`; height-constrained touch layouts use `useIsShortTouchScreen`.
- **Viewport and safe areas.** Use `100dvh`, explicit scroll owners, and `var(--safe-area-inset-*)` at the existing layout roots. `useVisualViewport` publishes `--visual-viewport-height/width/top/left` for keyboard-visible bounds. Shared Dialog, Sheet and game Modal own those bounds; callers must not replace them with a taller viewport limit or a stale centered width.
- **Touch has a non-hover path.** Reveal touch actions with `touch:opacity-100 touch:pointer-events-auto`; keep mouse hover and keyboard support on hybrid devices. Long-press preview uses the shared 450ms timing and 10px slop through `useLongPressPreview` or `LongPressGesture`.
- **Card action placement.** Commander and token thumbnails use a top-right action row on desktop and a bottom-right stack on touch. Keep these layout rules separate from typography adjustments.
- **Hover handlers on card tiles use `onPointerEnter`/`onPointerLeave` with an `e.pointerType === "touch"` early-return** — plain `onMouseEnter` fires on tap and strands the preview (no mouseleave ever comes on touch).
- **Tap targets.** Use `touch:min-h-11 touch:min-w-11` or a non-overlapping hit expander for at least 44 CSS pixels. Shared Button, Input, AppSelect, menu rows and close controls apply the policy. Grow geometry with text instead of clipping a readable label in a fixed-height box.
- **Native fields.** Use `text-ui-input` for raw inputs, textareas and selects. It remains at least 16px on touch at every width; a tablet-width `md:text-sm` must not override it.
- **rem for chrome, px for card art.** Panels, text, and spacing use rem-based Tailwind tokens so the `:root` font-size steps at 2000px and 3000px in `index.css` scale them on large monitors. `GAME_CARD_SIZES` stays in pixels; `useHandScale`, battlefield grid fitting, and preview viewport fitting apply runtime scale.
- **Drag gestures use pointer events, never mouse events** (`pointermove`/`pointerup`/`pointercancel`), filtered by `pointerId` so a second finger can't hijack, with `pointercancel` treated as abort.

### Semantic UI typography

`src/index.css` owns the rem-valued `--text-ui-*` properties. Use `text-ui-body` for prose, `text-ui-label` for controls and form labels, `text-ui-meta` for counts/status/help, and `text-ui-caption` only for nonessential captions. At the default root, compact touch viewports use 16px body/labels/fields and 14px metadata. Touch-capable viewports at least 48rem wide use 20px body/labels/fields, 18px metadata and 14px captions. The initial 16px/14px touch scale was too small in large-tablet review; do not treat minimum touch sizes as the wide-screen target. This tier changes semantic text tokens, not the root font size or card dimensions. It remains active with an attached mouse or keyboard. Preserve large headings, life totals, card-local printing and the large-monitor root steps.

At the default desktop root, UI body text and labels use 14px; metadata and captions use 12px. The inherited page font remains 16px. Adjust shared role tokens rather than adding desktop-restoration utilities to individual elements.

`cn()` registers these names as font sizes, so foreground colors survive role overrides. Register new roles in its font-size group and in `themes/typography.ts`. Keep role property values in rem because the imperative metric reader converts them using the current root size.

Pixi reads cached `getUiFontSize(role)`, `getUiControlHeight()` and `isTouchUi()` values. Touch capability uses the control-height/root-font ratio, not a fixed pixel threshold. The root theme lifecycle refreshes those metrics on resize and touch-capability changes and notifies `subscribeTheme`. Subscribers must rebuild text and associated bounds/hit areas, even when colors did not change. Account for a parent's transform when sizing UI controls; keep card fitting independent. The phase strip reserves per-opponent control widths only on touch devices; desktop indicators fit inside the existing cells without widening the strip as players join. Do not measure DOM styles per frame or scale UI text down to solve overflow.

Dense grids use content-width minimums or fewer columns. Long toolbars wrap; overflowing forms and choice lists scroll. Card shelves and spatial reorder/scry interactions may remain horizontal. Browser zoom remains enabled.

---

## 12. Testing Checklist

Assistant verification is static: `yarn tsc -b`, scoped ESLint, and Prettier. Build the frontend when changing stylesheet generation or bundling. Add no unit tests unless requested.

The maintainer owns app/device and visual acceptance: phone landscapes, foldables, tablet orientations, split-screen, attached keyboards/pointers, open keyboards, text zoom, and large-monitor scaling. Static checks do not establish visual approval.
