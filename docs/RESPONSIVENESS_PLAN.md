# App-wide responsiveness plan

Status: implemented on `feat/app-wide-responsiveness`. Static checks passed; maintainer runtime/device acceptance remains pending.

## Goal and scope

Make the Tauri and web app readable and usable across phones, unfolded phones, tablets, split-screen windows, desktops, and large monitors. Fix tablet typography without enlarging card sprites or forcing every touch screen into a phone page layout.

Scope includes shared controls and navigation, Play, offline setup, multiplayer and chat, Settings and account flows, search, collection, deck editing, Community, Limited setup and tables, Companion, game overlays, and their dialogs. The marketing website, engine behavior, native card-printing typography, brand fonts, and palette are unchanged.

## Baseline findings driving the plan

- Root scaling applied only above 2000px and 3000px; tablet CSS viewports did not receive a readable UI scale.
- Shared touch targets grew without consistently growing their labels.
- The shared Input's `text-base md:text-sm` reduced field text at tablet widths.
- Page metadata often used fixed 10–13px text while wider grids increased density.
- Canvas labels had independent explicit sizes, unaffected by CSS root scaling.
- Card Size was, and remains, a card preference rather than an app-wide text-size control.

## Responsive contract

### Separate available space from input capabilities

- Use available width for columns, side panels, navigation capacity, and dialog width. Use container sizing where a component can appear inside a narrower panel; use the existing viewport breakpoints for page structure.
- Use available height for compact chrome and scroll allocation. A short viewport must not make essential text smaller.
- Use touch capability for readable control sizes and touch targets. Add a shared `any-pointer: coarse` query for this policy so a tablet with an attached pointer can retain touch-friendly sizing.
- Preserve primary-pointer and hover checks for interaction behavior. Touch availability does not remove keyboard shortcuts or mouse hover support.
- Keep shared queries in `src/lib/responsive.ts`, with React consumers using `src/hooks/useBreakpoints.ts`. Do not add device-name or user-agent checks.
- Audit width-only uses of `useIsDesktop`; do not treat a wide viewport as proof of mouse input.

The existing short-touch gate and mobile-game scene gate remain distinct. Preserve the current foldable mobile board, tall-screen card-size cap, and vertical card-choice grids. New typography rules must not change which scene owns the board.

### Typography targets

Reference sizes below assume a 16px root. Use scalable units for DOM text and preserve browser text-size preferences.

| Role                                             | Fine-pointer UI | Compact touch UI | Wide touch UI, ≥48rem |
| ------------------------------------------------ | --------------- | ---------------- | --------------------- |
| Body and explanatory text                        | 16px            | 16px             | 20px                  |
| Primary controls, form labels, menu items        | 14px            | 16px             | 20px                  |
| Secondary labels, counts, status and helper text | 12–14px         | 14px minimum     | 18px                  |
| Nonessential captions                            | 12px minimum    | 12px minimum     | 14px                  |
| Input and textarea text                          | 14–16px         | 16px minimum     | 20px                  |

- Essential information is not a nonessential caption. Deck counts, game actions, validation messages, and selectable options must meet their role's size floor.
- Establish a small semantic text scale in the existing typography foundation. Share its reference values between DOM and Pixi; do not introduce a generated token framework.
- Do not globally redefine Tailwind `text-xs` or `text-sm`. Migrate app text by role so card rendering and intentionally specialized displays are not changed accidentally.
- Do not solve readability by increasing the root font size alone. That also grows rem-based spacing while leaving fixed-pixel and canvas text unchanged.
- Preserve the existing large-monitor root scaling and Source Sans 3 / Alegreya Sans font roles.

### Controls, layout, and overflow

- Touch controls retain at least 44 CSS pixels of usable hit area, including icon buttons and dialog actions.
- Increase control geometry with typography. Do not clip larger labels inside fixed-height controls.
- Collapse secondary tools into existing menus or sheets before reducing text size. Wrap labels where useful; truncate only when the full value remains available through inspection or details.
- Add grid columns only when each tile can retain readable content. Avoid a tablet-width transition that creates narrow desktop-density tiles.
- Default long forms, result lists, and tall card-choice dialogs to vertical scrolling. Keep horizontal scrolling for intentional shelves, tab strips, and spatial card interactions such as reorder or scry.
- Preserve the no-body-scroll contract, `100dvh`, safe-area variables, and existing layout-root inset ownership. Each overflowing region has an explicit scroll owner.
- Keep focused fields and confirmation actions reachable when the on-screen keyboard reduces the visible area. Prefer scrolling or stacked controls over scaling down the screen.
- Remove the global viewport request to disable user zoom. Keep game gesture suppression scoped to the existing game surfaces rather than using document-wide zoom restrictions.

### Pixi policy

- Apply the same semantic roles to game prompts, action labels, HUD metadata, tooltips, and Limited labels, using logical on-screen sizes rather than backing-buffer resolution.
- Recalculate affected button bounds, panel layout, clipping, and hit areas when text metrics change. Do not increase only `fontSize` inside an unchanged box.
- Resolve typography through existing initialization, breakpoint, and resize lifecycles, not per-frame DOM measurements or allocations.
- Keep text sizing separate from `cardSizeMultiplier`, battlefield fitting, hand sizing, and preview size.
- Do not change native printed-card text, card-face aspect ratios, or the square mobile battlefield footprint as part of UI typography work.

## Implementation sequence

### 1. Shared policy and controls

Targets: `src/lib/responsive.ts`, `src/hooks/useBreakpoints.ts`, `src/themes/typography.ts`, `src/index.css`, `src/components/ui/`, and `index.html`.

- Define shared text roles and touch-capability sizing rules.
- Update buttons, inputs, selects, labels, menus, dialogs, sheets, tooltips, and notifications.
- Remove the tablet input-size regression and document-wide zoom restriction.
- Find caller overrides that would undo the new shared defaults and include them in the migration inventory.

Completion: default controls meet the typography and target-size contract across width breakpoints; application text is not automatically reduced because a tablet becomes wider.

### 2. App shell and ordinary pages

Targets: navigation and account menus; Play; offline and multiplayer setup; lobby and chat; Settings, sign-in/account dialogs, About, loading, error, and empty states.

- Migrate text to the shared roles, including secondary copy and validation messages.
- Keep navigation usable with touch, mouse, or keyboard without squeezing its labels.
- Reflow forms and action rows according to available space, including short windows and open keyboards.

Completion: primary actions remain reachable; meaningful help and status text meet the size policy; navigation and page content do not overlap.

### 3. Dense card workspaces

Targets: Search, My Collection, Deck Editor, deck browsers and pickers, Community and Top Decks, and shared deck tiles.

- Replace tiny fixed text in names, counts, filters, legality indicators, and list metadata.
- Give tiles and list rows minimum content widths before increasing column counts.
- Adapt sidebars, filters, bulk actions, and editors to narrow containers and split-screen windows.
- Preserve shared deck/card components instead of making separate tablet versions.

Completion: browsing, filtering, selecting, and editing remain usable without tiny text or accidental page-level horizontal scrolling.

### 4. Limited and Companion

Targets: Limited setup, draft/sealed/Winston/gauntlet page layouts, and Companion controls and dialogs. Pixi text migration belongs to phase 5.

- Apply readable labels to DOM setup forms, timers, counters, and actions.
- Rebalance panes using available space while retaining card inspection and drag interactions.
- Preserve Companion's rotated-player layouts and press/hold semantics; resize their controls with the text.

Completion: every supported layout retains accessible controls and explicit scroll regions without shrinking labels to fit.

### 5. Game and shared Pixi overlays

Targets: `src/pixi/prompts/`, HUD/tooltips, shared Pixi text styles, Limited renderer text, and React game panels/modals.

- Migrate explicit text sizes and associated geometry to the shared roles.
- Preserve tall mobile vertical choose/reveal grids and short-screen horizontal strips.
- Preserve source previews, fixed prompt headers/footers, hand/action clearance, and independent mobile/desktop scene ownership.
- Keep battlefield sprite sizing unchanged by the typography migration.

Completion: actions and essential game text meet the readable-size contract without breaking prompt fit, touch hit areas, or card placement.

### 6. Consistency and guidance

- Complete the inventory of fixed-pixel small text and responsive overrides across every scoped surface. Classify exceptions by purpose rather than leaving unexplained leftovers.
- Update the existing Design System typography/component examples and gameplay labs; do not create a second reference gallery.
- Update `docs/STYLE_GUIDELINES.md` and affected agent guidance, including the inaccurate claim that the shared Input already preserves touch text size at every breakpoint.
- Remove superseded sizing rules during each cutover. No compatibility aliases or permanent duplicate tablet components.

Completion: every scoped surface is migrated or has a documented intentional exception, and shared guidance matches the implementation.

## Implementation record

All six source phases are implemented. CSS owns the semantic roles and touch-capability policy; cached Pixi metrics refresh through the existing theme lifecycle. Root-owned visible-viewport bounds cover shared portals. Shared controls, ordinary pages, dense workspaces, Limited, Companion, game DOM, Pixi prompts/HUDs and existing developer galleries consume the policy. Embedded rules-card controls account for both the owning card's stable screen scale and the inner preview transform.

Large-tablet review found the initial 16px labels and 14px metadata too small on a 13-inch iPad. Touch-capable viewports at least 48rem wide now use the larger tier above. Fine-pointer and compact-touch sizes remain unchanged. Existing resize notifications refresh cached Pixi metrics when crossing the tier; no root-font, scene-selection or card-size changes are needed.

Intentional exceptions retain their original purpose:

- Native card printing, fallback card faces and proportional card-local battlefield badges remain card presentation. Expanded inspection metadata uses UI roles.
- Large display headings and life/dice/statistic numerals retain their larger sizes.
- Decorative foil/booster artwork, die-face markings and print-only specimens stay proportional; nonessential timestamps and version identifiers use caption text.
- The third-party Redux inspector keeps its own styling. Intentional card shelves, import tables and spatial card interactions retain local horizontal scrolling.

No scene gates, engine behavior, card dimensions, Companion press/hold semantics or theme/font choices were changed.

## Verification and rollout

Implement in reviewable phases. Each phase includes all of its callers and related geometry changes; phase boundaries are not permission to leave broken consumers.

Assistant verification is static only: TypeScript project build, ESLint, formatting, and source-level callsite/override inspection. Do not run unit tests, smoke tests, browser/device emulation, screenshots, or visual checks. The maintainer owns runtime and device acceptance.

Completed static verification:

- `yarn tsc -b`.
- ESLint across the 418 changed TypeScript/TSX files; corrected the reported `prefer-const` binding and rechecked that file.
- Prettier across the 426 eligible changed source/guidance files.
- `yarn i18n:extract` for moved rules-preview message references.
- `yarn vite build`; emitted CSS includes semantic font utilities, the `any-pointer: coarse` policy and visible-viewport bounds.

The wide-touch correction also passes `yarn tsc -b`, ESLint on both updated gallery sections, scoped Prettier checks and `yarn vite build`. Emitted CSS retains the fine-pointer and compact-touch values, adds all five wide-touch role overrides behind `(any-pointer: coarse) and (min-width: 48rem)`, and keeps semantic utilities bound to those variables.

The production build reports mixed static/dynamic imports, large chunks and a Node deprecation warning. Catalog extraction reports one missing translation per non-English locale.

Maintainer review should cover narrow phones and short landscapes; folded/unfolded phones; iPad mini, ordinary iPad/Air, and large iPad Pro classes in both orientations; Android tablets; split-screen windows; tablets with a mouse/keyboard; ordinary desktops; and the existing large-monitor scaling tiers. Use actual CSS viewport dimensions, not hardware display resolution.

Acceptance applies to light and dark modes, long labels, error states, open keyboards, text zoom, open dialogs, and dense card collections. Essential text stays readable, primary actions remain reachable, and no interaction depends exclusively on hover.

The rollout is complete only after all scoped surfaces satisfy the contract and the maintainer has reviewed the device behavior. Passing static checks is not a claim of visual approval.
