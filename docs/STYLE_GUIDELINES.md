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
export const BATTLEFIELD_CARD = "w-[70px] h-[98px] shrink-0" as const;
```

```tsx
// BattlefieldZone.tsx
<Card className={cn(BATTLEFIELD_CARD, "hover:z-10")} />
```

### Always use `cn()` for conditional classes

Never use template literals for conditional Tailwind. Use `cn()` from `@/lib/utils`:

```tsx
// ✅ Good
className={cn("text-sm", isActive && "font-bold")}

// ❌ Bad
className={`text-sm ${isActive ? "font-bold" : ""}`}
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

Use the standard size constants — don't invent new pixel values:

| Constant           | Value                 | Usage                         |
| ------------------ | --------------------- | ----------------------------- |
| `BATTLEFIELD_CARD` | `w-[70px] h-[98px]`   | Cards on the battlefield      |
| `HAND_CARD`        | `w-[80px] h-[112px]`  | Cards in hand / zone viewer   |
| `MODAL_CARD_SIZE`  | `w-[100px] h-[140px]` | Cards inside modal grids      |
| `FLASH_CARD_SIZE`  | `w-[240px] h-[336px]` | Flash overlay / large preview |

---

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
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  </div>
</Modal.Header>
```

### Mana text rendering

Use the shared `TextWithMana` component for any text that may contain `{W}`, `{2}{R}`, etc.:

```tsx
import { TextWithMana } from "@/components/game/TextWithMana";
<TextWithMana text={description} manaSize="sm" />;
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
comes from a preset file under `src/themes/` and flows through the
resolution pipeline.

### Architecture overview

```
BasePalette (~30 raw hues per preset)
  → buildGameColors(palette): GameThemeColorMap  (~80 semantic tokens)
    → resolveGameThemeColors():  default preset → active preset → user overrides
      → flatToGameTheme():       nested GameThemeColors object
        → flattenGameThemeToCssVars():  --kebab-case CSS vars on :root
          → Tailwind @theme block:       bg-pointer-hostile, text-mana-w, …
```

| Surface                   | Source of truth                             | Accessor                                                       |
| ------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| App chrome (Radix/shadcn) | `ThemePreset.light` / `.dark` HSL maps      | `useTheme()`                                                   |
| Game board / Pixi canvas  | `ThemePreset.gameColors: GameThemeColorMap` | `useTheme().gameTheme` (React) / `getTheme().gameTheme` (Pixi) |

### Where colours live

| File                            | Role                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/themes/gameTheme.ts`       | `GameThemeColors` interface, `GameThemeColorKey` union type, `GameThemeColorMap` typed record, resolution logic, CSS flattening, colour utilities |
| `src/themes/buildGameColors.ts` | `BasePalette` interface, `buildGameColors()` that maps ~30 hues → 80 typed tokens                                                                 |
| `src/themes/default.ts`         | Default palette + preset (fallback for every token)                                                                                               |
| `src/themes/<name>.ts`          | Per-preset palette overrides (nord, dracula, catppuccin, …)                                                                                       |
| `src/themes/presets.ts`         | `ThemePreset` interface, preset registry                                                                                                          |
| `src/hooks/useTheme.ts`         | React hook `useTheme()`, imperative `getTheme()`, CSS var injection                                                                               |
| `src/index.css`                 | `@theme` block mapping CSS vars to Tailwind utilities (auto-generated)                                                                            |

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
   Use theme-token utilities instead: `bg-pointer-hostile`,
   `text-counter-p1p1`, `ring-card-ring`, `bg-pt-buffed`,
   `text-format-badge-blue`, `text-legality-legal`, etc. Every key in
   `GameThemeColors` has matching `bg-*` / `text-*` / `ring-*` /
   `border-*` utilities via the `@theme` block in `src/index.css`.
3. **No colour fallbacks in components or Pixi layers.** The resolution
   chain guarantees every token is a non-empty string. Never write
   `theme.pointer.hostile ?? "#ff0000"` or `safeColor(raw, fallback)`.
4. **Pixi code reads theme directly** via `getTheme().gameTheme.*` or
   the `theme` field set by `setTheme()`. No optional chaining needed.
5. **The one narrow exception**: pure `rgba(0, 0, 0, X)` shadow idioms
   in Tailwind arbitrary classes (`shadow-[0_10px_30px_rgba(0,0,0,0.35)]`)
   are allowed when the shadow is intentionally physics-black.

### When introducing a new colour

1. Add the field to `GameThemeColors` in `src/themes/gameTheme.ts`.
2. Add the mapping in `buildGameColors()` in `src/themes/buildGameColors.ts`
   (maps a `BasePalette` hue to the new token). If a new base hue is
   needed, add it to the `BasePalette` interface and every preset file.
3. Run `node scripts/generate-theme-css.mjs --write` to regenerate the
   `@theme` CSS block in `src/index.css`.
4. The new token is immediately available as a Tailwind utility
   (e.g. `bg-my-new-token`) and via `useTheme().gameTheme.myNewToken`.
   All 12 presets automatically get a value via `buildGameColors`.

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
| Style constants     | UPPER_SNAKE_CASE        | `BATTLEFIELD_CARD`    |
| Type/Interface      | PascalCase              | `CombatAssignment`    |
| Utility functions   | camelCase               | `getPromptLabel`      |

---

## 11. Responsive & Touch

The app targets smartphones/tablets (touch, small landscape screens) through huge desktop monitors.

- **Breakpoint constants live in `src/lib/responsive.ts`** (`DESKTOP_QUERY`, `SHORT_SCREEN_QUERY`, `COARSE_POINTER_QUERY`, long-press timings). JS gates use `useMediaQuery` or the `useIsTouch` / `useIsDesktop` / `useIsShortScreen` wrappers in `src/hooks/useBreakpoints.ts`. Don't inline `matchMedia` query strings.
- **`dvh`, never `vh`**, for viewport heights (`max-h-[85dvh]`); `env(safe-area-inset-*)` for notch/home-indicator padding. See `src/AGENTS.md` "page never scrolls".
- **Hover is not a feature on touch.** Every hover-only affordance needs a touch path: reveal overlays with `pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto`, and previews via **long-press = preview** — the app-wide convention (450ms hold, <10px movement, release hides, the release-tap is swallowed). DOM surfaces use `useLongPressPreview` (`src/hooks/useLongPressPreview.ts`); Pixi surfaces use `LongPressGesture` (`src/pixi/LongPressGesture.ts`).
- **Hover handlers on card tiles use `onPointerEnter`/`onPointerLeave` with an `e.pointerType === "touch"` early-return** — plain `onMouseEnter` fires on tap and strands the preview (no mouseleave ever comes on touch).
- **Tap targets**: interactive elements get ≥40px on coarse pointers — either `pointer-coarse:h-10`-style bumps or an invisible hit expander (`relative … before:absolute before:-inset-2.5 before:content-['']`). The `Button` primitive already bumps its sizes under `pointer-coarse:`.
- **Native `<select>`/`<input>` need ≥16px font on touch** (`pointer-coarse:text-base`) or iOS zooms the page on focus. The `Input` primitive handles this; raw elements must add it.
- **rem for chrome, px for card art.** Panels/text/spacing use rem-based Tailwind tokens so the `:root` font-size steps at 2000px/3000px (in `index.css`) scale them on big monitors. Card-size constants (`BATTLEFIELD_CARD`, `CARD_WIDTH_MAP`, …) stay px — card art has a native resolution and scaling is handled per-surface (`useHandScale`, battlefield fill scale, size tiers).
- **Drag gestures use pointer events, never mouse events** (`pointermove`/`pointerup`/`pointercancel`), filtered by `pointerId` so a second finger can't hijack, with `pointercancel` treated as abort.

---

## 12. Testing Checklist

Before committing UI changes:

1. `yarn tsc -p tsconfig.app.json --noEmit` — must pass with zero errors
2. `yarn tauri dev` — app must build and render correctly
3. Visual spot-check: verify the changed components look identical to before
4. Touch-affecting changes: spot-check in DevTools device emulation (long-press previews, tap targets, no stranded hover previews)
