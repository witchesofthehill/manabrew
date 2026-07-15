import type { GameIconName } from "@/components/game/GameIcon";

export interface NavEntry {
  id: string;
  label: string;
}

export const SECTIONS: NavEntry[] = [
  { id: "brand", label: "Brand" },
  { id: "color", label: "Color" },
  { id: "typography", label: "Typography" },
  { id: "icons", label: "Iconography" },
  { id: "components", label: "Components" },
  { id: "cards", label: "Card faces" },
  { id: "spacing", label: "Spacing & radius" },
  { id: "assets", label: "Assets" },
];

// Curated from an app-wide `lucide-react` import audit, grouped by where the
// icon actually appears. Not exhaustive — a representative reference set.
export const LUCIDE_GROUPS: { group: string; names: string[] }[] = [
  {
    group: "Navigation",
    names: [
      "Swords",
      "Globe",
      "Search",
      "Layers",
      "HeartPulse",
      "Package",
      "Gamepad2",
      "Settings",
      "Info",
      "Hand",
      "Menu",
      "ChevronLeft",
      "ChevronRight",
    ],
  },
  {
    group: "Status & feedback",
    names: [
      "Loader2",
      "AlertCircle",
      "AlertTriangle",
      "TriangleAlert",
      "OctagonAlert",
      "CircleCheck",
      "Check",
      "BadgeCheck",
      "Wifi",
      "WifiOff",
      "Lock",
      "X",
    ],
  },
  {
    group: "Actions & editing",
    names: [
      "Plus",
      "Minus",
      "Save",
      "Trash2",
      "Copy",
      "Pencil",
      "RotateCcw",
      "RotateCw",
      "Shuffle",
      "Tag",
      "Bookmark",
      "GripVertical",
      "SlidersHorizontal",
      "LayoutGrid",
      "List",
    ],
  },
  {
    group: "Game & lobby",
    names: [
      "Shield",
      "Sword",
      "Flag",
      "Skull",
      "Heart",
      "Crown",
      "Crosshair",
      "Hourglass",
      "Bot",
      "Cpu",
      "Cloud",
      "Users",
      "Gem",
      "Sparkles",
      "Wand2",
      "Coins",
      "Anvil",
      "Dice5",
    ],
  },
];

export const GAME_ICONS: GameIconName[] = [
  "crown",
  "rolled-cloth",
  "card-pickup",
  "poison-bottle",
  "lightning-trio",
  "crossed-swords",
  "radioactive",
  "stone-tower",
  "ring",
  "speedometer",
  "book-cover",
  "book-aura",
  "overlord-helm",
  "muscle-up",
  "skull-crack",
  "shiny-omega",
  "vibrating-shield",
  "round-shield",
  "scroll-quill",
  "spell-book",
  "hourglass",
  "stopwatch",
  "ghost",
  "rank-3",
  "stack",
  "mining",
  "brick-wall",
  "battery-pack-alt",
  "scroll-unfurled",
  "anvil",
  "beer-stein",
  "deck",
  "graveyard",
  "exile",
];

// Mirrors `COUNTER_CONFIG` in CounterBadge.tsx (not exported there).
export const COUNTER_TYPES: string[] = [
  "P1P1",
  "M1M1",
  "Loyalty",
  "Charge",
  "Quest",
  "Study",
  "Lore",
  "Age",
  "Time",
  "Fade",
  "Level",
  "Storage",
  "Mining",
  "Brick",
  "Depletion",
  "Page",
  "Shield",
];

export const MANA_COSTS: { label: string; cost: string }[] = [
  { label: "Mono", cost: "{W}{U}{B}{R}{G}{C}" },
  { label: "Generic", cost: "{X}{2}{1}{0}" },
  { label: "Hybrid", cost: "{W/U}{B/R}{2/W}" },
  { label: "Phyrexian", cost: "{W/P}{U/P}{G/P}" },
  { label: "Typical spell", cost: "{3}{W}{W}" },
];

export const FONTS: { role: string; stack: string; cls: string; weights: string; use: string }[] = [
  {
    role: "Sans — body / UI",
    stack: "Alegreya Sans",
    cls: "font-sans",
    weights: "400 · 500 · 700",
    use: "Default body text, controls, panels",
  },
  {
    role: "Serif — display",
    stack: "Cormorant Garamond",
    cls: "font-serif",
    weights: "600 · 700",
    use: "Hero headings (light weight, wide tracking)",
  },
  {
    role: "Game — board",
    stack: "Inter",
    cls: "font-game",
    weights: "400–900",
    use: "In-game surface + Pixi canvas text",
  },
];

export const GAME_FONT_SIZES: { token: string; value: string; use: string }[] = [
  { token: "badgeCount", value: "13px", use: "Count next to row badges (monarch, poison…)" },
  { token: "life", value: "14px", use: "Life total in the avatar heart chip" },
  { token: "manaCount", value: "11px", use: "Per-color count before each mana pip" },
  { token: "zoneCount", value: "14px", use: "Count over zone tiles (Lib / GY / Exile)" },
  { token: "zoneLabel", value: "10px", use: "Uppercase zone label under each tile" },
  { token: "avatarInitials", value: "16px", use: "Initials when a player has no avatar" },
];

export const RADIUS_TOKENS: { token: string; value: string; cls: string }[] = [
  { token: "--radius-sm", value: "calc(0.5rem − 4px)", cls: "rounded-sm" },
  { token: "--radius-md", value: "calc(0.5rem − 2px)", cls: "rounded-md" },
  { token: "--radius-lg", value: "0.5rem", cls: "rounded-lg" },
  { token: "--radius (base)", value: "0.5rem", cls: "rounded-[--radius]" },
];

export const CARD_SIZES: { token: string; dims: string; where: string }[] = [
  { token: "Battlefield (DOM)", dims: "70 × 98", where: "BATTLEFIELD_CARD" },
  { token: "Battlefield (Pixi grid)", dims: "72 × 100", where: "CARD_W × CARD_H" },
  { token: "Hand", dims: "80 × 112", where: "HAND_CARD" },
  { token: "Modal", dims: "100 × 140", where: "MODAL_CARD_SIZE" },
  { token: "Mulligan", dims: "160 × 222", where: "MULLIGAN_CARD_SIZE" },
  { token: "Thumbnail", dims: "60 × 84", where: "MODAL_CARD_THUMBNAIL" },
];

export const ASSETS: { file: string; kind: string; use: string; preview?: string }[] = [
  {
    file: "public/manabrew_brewery_1.png",
    kind: "Backdrop",
    use: "Full-bleed brand art",
    preview: "/manabrew_brewery_1.png",
  },
  {
    file: "public/manabrew_brewery_2.png",
    kind: "Backdrop",
    use: "Alternate brand art",
    preview: "/manabrew_brewery_2.png",
  },
  {
    file: "public/apple-touch-icon.png",
    kind: "PWA icon",
    use: "iOS home-screen + 512px maskable",
    preview: "/apple-touch-icon.png",
  },
  {
    file: "public/icon-192x192.png",
    kind: "PWA icon",
    use: "192px maskable",
    preview: "/icon-192x192.png",
  },
  {
    file: "public/favicon-128x128.png",
    kind: "Favicon",
    use: "128px PNG favicon",
    preview: "/favicon-128x128.png",
  },
  {
    file: "public/favicon-32x32.png",
    kind: "Favicon",
    use: "32px PNG favicon",
    preview: "/favicon-32x32.png",
  },
  {
    file: "public/favicon.ico",
    kind: "Favicon",
    use: "Classic .ico favicon",
    preview: "/favicon.ico",
  },
];

export const DATA_ASSETS: { file: string; use: string }[] = [
  { file: "public/token_archive.json", use: "MTG token card archive (3.3 MB) — token lookups" },
  { file: "public/wasm/cardset.*.rkyv", use: "rkyv-serialized card set for the engine" },
  { file: "public/preset_decks/*.json", use: "~50 starter / commander decks + index.json" },
  { file: "public/manifest.webmanifest", use: "PWA manifest (name, icons, theme color)" },
  { file: "public/config.js", use: "Runtime relay config for self-hosted deploys" },
];
