// ─── Routes ──────────────────────────────────────────────────────────────────

export const ROUTES = {
  LOBBY: "/lobby",
  PLAY: "/play",
  SEARCH: "/search",
  DECK_EDITOR: "/deck-editor",

  SETTINGS: "/settings",
} as const;

// ─── External Links ──────────────────────────────────────────────────────────

export const GITHUB_REPO_URL = "https://github.com/witchesofthehill/manabrew";
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
export const GITHUB_LATEST_RELEASE_API =
  "https://api.github.com/repos/witchesofthehill/manabrew/releases/latest";
export const DISCORD_INVITE_URL = "https://discord.gg/NqrKpbhtcd";
export const WEBSITE_URL = "https://manabrew.app";
export const DOCS_URL = "https://docs.manabrew.app";

// ─── App Version ─────────────────────────────────────────────────────────────

export const APP_VERSION = __APP_VERSION__;

// ─── Storage Keys ────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  DECK: "manabrew-deck-storage",
  PREFERRED_PRINTS: "manabrew-preferred-prints",
  PREFERENCES: "manabrew-preferences",
  COMPANION: "manabrew-companion",
  KEYBINDINGS: "manabrew-keybindings",
  STATUS_BANNER: "manabrew-status-banner",
} as const;

// ─── Deck Defaults ───────────────────────────────────────────────────────────

export const DEFAULT_DECK_NAME = "New Deck";

// ─── Formats & Legalities ────────────────────────────────────────────────────

export const FORMAT_DISPLAY: Record<string, string> = {
  standard: "Standard",
  pioneer: "Pioneer",
  modern: "Modern",
  legacy: "Legacy",
  vintage: "Vintage",
  commander: "Commander",
  pauper: "Pauper",
  historic: "Historic",
  brawl: "Brawl",
};

export const LEGALITY_STYLES: Record<string, string> = {
  legal: "bg-legality-legal/20 text-legality-legal border-legality-legal/30",
  banned: "bg-legality-banned/20 text-legality-banned border-legality-banned/30",
  restricted: "bg-legality-restricted/20 text-legality-restricted border-legality-restricted/30",
  not_legal: "bg-muted text-muted-foreground border-border",
};

// ─── Drag & Drop IDs ────────────────────────────────────────────────────────

export const DROP_ZONE = {
  MAIN: "drop-main",
  SIDE: "drop-side",
  MAYBE: "drop-maybe",
  TAG_PREFIX: "drop-tag-",
} as const;

// ─── Set Types ──────────────────────────────────────────────────────────────

export const MAIN_SET_TYPES = new Set([
  "core",
  "expansion",
  "masters",
  "draft_innovation",
  "commander",
  "starter",
  "remaster",
]);
