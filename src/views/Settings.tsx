import { useState } from "react";
import { toast } from "sonner";
import {
  CARD_SIZE_MULTIPLIER_MAX,
  CARD_SIZE_MULTIPLIER_MIN,
  usePreferencesStore,
  type ZonePanelItem,
} from "@/stores/usePreferencesStore";
import { isFeatureEnabled } from "@/featureFlags";
import { IRONSMITH_WASM_AVAILABLE } from "@/game/ironsmithWasmAvailable";
import { relayUsername } from "@/lib/relayUsername";
import { BattlefieldStylePreview } from "@/components/game/BattlefieldStylePreview";
import {
  INLINE_CARD_STYLE_OPTIONS,
  IN_GAME_CARD_PREVIEW_STYLE_OPTIONS,
} from "@/components/game/cardPreviewStyles";
import { HAND_ORDER_OPTIONS } from "@/lib/handOrder";
import { PlaymatEditorModal } from "@/components/editor/PlaymatEditorModal";
import { useAssetStore, useAssetsAvailable, useAssetUrl } from "@/stores/useAssetStore";
import { THEME_PRESETS, type ThemeColors } from "@/themes";
import { useServerStore } from "@/stores/useServerStore";
import { useGameStore } from "@/stores/useGameStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { PromptPreferencesPanel } from "@/components/prompts/internal/PromptPreferencesPanel";
import { KeybindingsPanel } from "@/components/settings/KeybindingsPanel";
import { AccountSection } from "@/components/settings/AccountSection";
import { MyAssetsSection } from "@/components/settings/MyAssetsSection";
import { CardArtDownloadSection } from "@/components/settings/CardArtDownloadSection";
import { PreferenceCard } from "@/components/settings/PreferenceCard";
import { LanguagePreferenceCard } from "@/components/settings/LanguagePreferenceCard";
import { toPickerHexColor } from "@/themes/gameTheme";
import type { GameThemeColors } from "@/themes/gameTheme";
import { getDefaultGameThemeColorMap } from "@/hooks/useTheme";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTheme as useColorMode } from "next-themes";
import { Navigate, useLocation } from "react-router-dom";
import { HelpCircle, Minus, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { KNOWN_RELAYS, type KnownRelay } from "@/config/knownRelays";
import { cn } from "@/lib/utils";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
/**
 * Canonical key unions. These drive the typed colour-description maps
 * below so a typo in a description key fails at compile time and adding
 * a new token to the schema shows up as a missing-description TS error
 * (via the `Record<…>` form used on the descriptions themselves — not
 * `Partial<Record<…>>` — so exhaustiveness is enforced).
 */
type AppThemeKey = keyof ThemeColors;
/**
 * Dot-notation string keys for every leaf in `GameThemeColors`.
 * Produces `"pointer.hostile" | "mana.W" | "textOnTinted" | …` at the
 * TS level; `Partial<Record<GameThemePath, string>>` on the description
 * map catches typos without forcing every leaf to be documented at
 * once. Add new tokens to the schema first — the description keys are
 * then type-checked against the live shape.
 */
type GameThemePath = {
  [K in keyof GameThemeColors & string]: GameThemeColors[K] extends string
    ? K
    : GameThemeColors[K] extends Record<string, string>
      ? `${K}.${keyof GameThemeColors[K] & string}`
      : never;
}[keyof GameThemeColors & string];
const APP_THEME_COLOR_DESCRIPTIONS: Record<AppThemeKey, string> = {
  get background() {
    return i18n._(msg`Page / window background fill.`);
  },
  get foreground() {
    return i18n._(msg`Default body text colour.`);
  },
  get card() {
    return i18n._(msg`Surface colour for cards, panels, and solid containers.`);
  },
  get "card-foreground"() {
    return i18n._(msg`Text colour placed on \`card\` surfaces.`);
  },
  get popover() {
    return i18n._(msg`Background of popovers, menus, and floating panels.`);
  },
  get "popover-foreground"() {
    return i18n._(msg`Text colour inside popovers.`);
  },
  get primary() {
    return i18n._(
      msg`Primary action colour \u2014 main call-to-action buttons, links, active chip fills.`,
    );
  },
  get "primary-foreground"() {
    return i18n._(msg`Text / icons placed on a \`primary\` background.`);
  },
  get secondary() {
    return i18n._(msg`Secondary / subtle button background.`);
  },
  get "secondary-foreground"() {
    return i18n._(msg`Text on secondary-style buttons.`);
  },
  get muted() {
    return i18n._(msg`Muted surface for low-priority regions.`);
  },
  get "muted-foreground"() {
    return i18n._(msg`Captions, hints, and secondary text colour.`);
  },
  get accent() {
    return i18n._(msg`Hover / active highlight surface.`);
  },
  get "accent-foreground"() {
    return i18n._(msg`Text on accent surfaces.`);
  },
  get destructive() {
    return i18n._(msg`Destructive actions, errors, and deny states.`);
  },
  get "destructive-foreground"() {
    return i18n._(msg`Text placed on \`destructive\` buttons.`);
  },
  get border() {
    return i18n._(msg`Default border and divider lines.`);
  },
  get input() {
    return i18n._(msg`Form input borders and backgrounds.`);
  },
  get ring() {
    return i18n._(msg`Focus ring around interactive elements.`);
  },
  get selection() {
    return i18n._(msg`Background of selected text.`);
  },
  get "selection-foreground"() {
    return i18n._(msg`Colour of selected text itself.`);
  },
  get commander() {
    return i18n._(msg`Commander indicator (crown icon, commander panel accent).`);
  },
  get warning() {
    return i18n._(msg`Warning states and soft cautions.`);
  },
  get overlay() {
    return i18n._(msg`Modal / dialog backdrop dim.`);
  },
};
const GAME_THEME_COLOR_DESCRIPTIONS: Partial<Record<GameThemePath, string>> = {
  get "activeAction.priority"() {
    return i18n._(msg`Highlight surrounding the player who currently has priority.`);
  },
  get "activeAction.active"() {
    return i18n._(msg`Active-turn ring, turn-text colour, and general 'your turn' cue.`);
  },
  get "promptAction.passAction"() {
    return i18n._(msg`Pass priority / pass turn button fill.`);
  },
  get "promptAction.attackAction"() {
    return i18n._(msg`Declare-attackers button fill.`);
  },
  get "promptAction.defenseAction"() {
    return i18n._(msg`Defense / declare-blockers button fill.`);
  },
  get "promptAction.cancel"() {
    return i18n._(msg`Cancel / decline button fill.`);
  },
  get "arrow.attack"() {
    return i18n._(msg`Attacker arrow from attacker to defender.`);
  },
  get "arrow.block"() {
    return i18n._(msg`Blocker arrow from blocker to attacker.`);
  },
  get "arrow.hostileTarget"() {
    return i18n._(msg`Legacy hostile-target arrow (Pixi fallback).`);
  },
  get "arrow.friendlyTarget"() {
    return i18n._(msg`Legacy friendly-target arrow (Pixi fallback).`);
  },
  get "pointer.hostile"() {
    return i18n._(
      msg`Glow around the cursor for hostile targeting \u2014 damage, destroy, sacrifice, exile, counter, etc. Also used for the mulligan-reject ring.`,
    );
  },
  get "pointer.friendly"() {
    return i18n._(
      msg`Glow around the cursor for friendly / supportive targeting \u2014 buff, heal, draw, reveal, untap, attach, copy.`,
    );
  },
  get "mana.W"() {
    return i18n._(msg`White mana pip and dual-land tap-button tint.`);
  },
  get "mana.U"() {
    return i18n._(msg`Blue mana pip and dual-land tap-button tint.`);
  },
  get "mana.B"() {
    return i18n._(msg`Black mana pip and dual-land tap-button tint.`);
  },
  get "mana.R"() {
    return i18n._(msg`Red mana pip and dual-land tap-button tint.`);
  },
  get "mana.G"() {
    return i18n._(msg`Green mana pip and dual-land tap-button tint.`);
  },
  get "mana.C"() {
    return i18n._(msg`Colorless mana pip and tap-button tint.`);
  },
  get "cardStatus.exerted"() {
    return i18n._(msg`Badge colour for exerted creatures (won't untap).`);
  },
  get "cardStatus.morph"() {
    return i18n._(msg`Badge for face-down / morph creatures.`);
  },
  get "cardStatus.bestow"() {
    return i18n._(msg`Badge for bestowed auras.`);
  },
  get "cardStatus.token"() {
    return i18n._(msg`Badge for token creatures.`);
  },
  get "cardStatus.transformed"() {
    return i18n._(msg`Badge for transformed double-faced cards.`);
  },
  get "cardStatus.plotted"() {
    return i18n._(msg`Badge for plotted cards in exile.`);
  },
  get "cardStatus.madness"() {
    return i18n._(msg`Badge for madness-exiled cards.`);
  },
  get "cardStatus.warped"() {
    return i18n._(msg`Badge for warp-exiled cards.`);
  },
  get "cardStatus.copy"() {
    return i18n._(msg`Badge for permanents that are copies of another card.`);
  },
  get "counter.default"() {
    return i18n._(msg`Fallback chip colour for unknown counter types.`);
  },
  get "counter.p1p1"() {
    return i18n._(msg`+1/+1 counter chip.`);
  },
  get "counter.m1m1"() {
    return i18n._(msg`-1/-1 counter chip.`);
  },
  get "counter.loyalty"() {
    return i18n._(msg`Loyalty counter chip (planeswalkers).`);
  },
  get "counter.charge"() {
    return i18n._(msg`Charge counter chip.`);
  },
  get "counter.quest"() {
    return i18n._(msg`Quest counter chip.`);
  },
  get "counter.study"() {
    return i18n._(msg`Study counter chip.`);
  },
  get "counter.lore"() {
    return i18n._(msg`Lore counter chip (sagas).`);
  },
  get "counter.age"() {
    return i18n._(msg`Age counter chip.`);
  },
  get "counter.time"() {
    return i18n._(msg`Time counter chip (suspend, etc.).`);
  },
  get "counter.fade"() {
    return i18n._(msg`Fade counter chip.`);
  },
  get "counter.level"() {
    return i18n._(msg`Level counter chip (level-up creatures).`);
  },
  get "counter.storage"() {
    return i18n._(msg`Storage counter chip.`);
  },
  get "counter.mining"() {
    return i18n._(msg`Mining counter chip.`);
  },
  get "counter.brick"() {
    return i18n._(msg`Brick counter chip.`);
  },
  get "counter.depletion"() {
    return i18n._(msg`Depletion counter chip.`);
  },
  get "counter.page"() {
    return i18n._(msg`Page counter chip (book rooms).`);
  },
  get "pt.neutral"() {
    return i18n._(msg`P/T badge when stats match the printed base.`);
  },
  get "pt.lethal"() {
    return i18n._(msg`P/T badge when incoming damage would be lethal.`);
  },
  get "pt.buffed"() {
    return i18n._(msg`P/T badge when stats are above the printed base.`);
  },
  get "pt.debuffed"() {
    return i18n._(msg`P/T badge when stats are below the printed base.`);
  },
  get success() {
    return i18n._(msg`Positive states \u2014 connected, saved, victory banner, good FPS.`);
  },
  get poison() {
    return i18n._(msg`Poison counter / skull icon \u2014 MTG infect-green.`);
  },
  get life() {
    return i18n._(msg`Life total / heart icon.`);
  },
  get "canvas.background"() {
    return i18n._(msg`Pixi canvas table background fill.`);
  },
  get "canvas.shadow"() {
    return i18n._(msg`Drop-shadow ink (almost always black).`);
  },
  get "canvas.neutral"() {
    return i18n._(msg`High-contrast stroke / outline colour for arrows and icons.`);
  },
  get "cardPlaceholder.fill"() {
    return i18n._(msg`Loading-state card sprite fill.`);
  },
  get "cardPlaceholder.stroke"() {
    return i18n._(msg`Loading-state card sprite border.`);
  },
  get textOnTinted() {
    return i18n._(msg`Text colour placed on tinted chips and badges.`);
  },
  get textMuted() {
    return i18n._(msg`Subdued label colour on empty-zone placeholders.`);
  },
  get textGhost() {
    return i18n._(msg`Ghost card-name colour shown while art loads.`);
  },
  get cardRing() {
    return i18n._(msg`Default card selection / focus ring.`);
  },
};
/**
 * Small `?` hover-help icon shown next to a picker label. Renders a
 * custom CSS tooltip below the icon on hover / focus — native `title`
 * attributes don't always fire reliably and are slow to appear, so we
 * drive the popover with tailwind `group-hover` + `group-focus-within`.
 * An invisible native `title` + `aria-label` remain for screen readers
 * and for users who expect the OS tooltip as a fallback.
 */
function HelpMark({ description }: { description: string | undefined }) {
  if (!description) return null;
  return (
    <span
      className="group relative inline-flex items-center"
      tabIndex={0}
      role="button"
      aria-label={description}
    >
      <HelpCircle className="h-3 w-3 text-muted-foreground/60 group-hover:text-foreground group-focus-within:text-foreground cursor-help" />
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-0 top-full z-50 mt-1 w-56 whitespace-normal",
          "rounded-md border bg-popover px-2 py-1.5 text-[11px] leading-snug text-popover-foreground shadow-lg",
          "opacity-0 -translate-y-1 transition-all duration-150",
          "group-hover:opacity-100 group-hover:translate-y-0",
          "group-focus-within:opacity-100 group-focus-within:translate-y-0",
        )}
      >
        {description}
      </span>
    </span>
  );
}
const APP_THEME_COLOR_LABELS: Record<AppThemeKey, string> = {
  get background() {
    return i18n._(msg`Background`);
  },
  get foreground() {
    return i18n._(msg`Text`);
  },
  get card() {
    return i18n._(msg`Card Surface`);
  },
  get "card-foreground"() {
    return i18n._(msg`Card Text`);
  },
  get popover() {
    return i18n._(msg`Popover Surface`);
  },
  get "popover-foreground"() {
    return i18n._(msg`Popover Text`);
  },
  get primary() {
    return i18n._(msg`Primary`);
  },
  get "primary-foreground"() {
    return i18n._(msg`Primary Text`);
  },
  get secondary() {
    return i18n._(msg`Secondary`);
  },
  get "secondary-foreground"() {
    return i18n._(msg`Secondary Text`);
  },
  get muted() {
    return i18n._(msg`Muted Surface`);
  },
  get "muted-foreground"() {
    return i18n._(msg`Muted Text`);
  },
  get accent() {
    return i18n._(msg`Accent`);
  },
  get "accent-foreground"() {
    return i18n._(msg`Accent Text`);
  },
  get destructive() {
    return i18n._(msg`Destructive`);
  },
  get "destructive-foreground"() {
    return i18n._(msg`Destructive Text`);
  },
  get border() {
    return i18n._(msg`Border`);
  },
  get input() {
    return i18n._(msg`Input`);
  },
  get ring() {
    return i18n._(msg`Focus Ring`);
  },
  get selection() {
    return i18n._(msg`Selection`);
  },
  get "selection-foreground"() {
    return i18n._(msg`Selection Text`);
  },
  get commander() {
    return i18n._(msg`Commander`);
  },
  get warning() {
    return i18n._(msg`Warning`);
  },
  get overlay() {
    return i18n._(msg`Overlay`);
  },
};
const APP_THEME_GROUPS: {
  heading: string;
  description: string;
  keys: AppThemeKey[];
}[] = [
  {
    heading: "Surfaces & Foregrounds",
    get description() {
      return i18n._(
        msg`Neutral page, card, and popover backgrounds plus their paired text colours.`,
      );
    },
    keys: ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground"],
  },
  {
    heading: "Brand & Accent",
    get description() {
      return i18n._(msg`Primary action colour and the softer accent / secondary tints.`);
    },
    keys: [
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "accent",
      "accent-foreground",
    ],
  },
  {
    heading: "State Signals",
    get description() {
      return i18n._(msg`Destructive, warning, commander, and selection highlights.`);
    },
    keys: [
      "destructive",
      "destructive-foreground",
      "warning",
      "commander",
      "selection",
      "selection-foreground",
    ],
  },
  {
    heading: "Muted & Structure",
    get description() {
      return i18n._(msg`Subdued surfaces, borders, input fields, focus ring, and overlay dim.`);
    },
    keys: ["muted", "muted-foreground", "border", "input", "ring", "overlay"],
  },
];
const GAME_THEME_GROUPS: {
  heading: string;
  description: string;
  prefixes?: string[];
  exactKeys?: string[];
}[] = [
  {
    heading: "Active Action",
    get description() {
      return i18n._(msg`Priority ring, turn glow, and related active-state cues.`);
    },
    prefixes: ["activeAction."],
  },
  {
    heading: "Prompt Buttons",
    get description() {
      return i18n._(msg`Pass, attack, defense, cancel, and related prompt action buttons.`);
    },
    prefixes: ["promptAction."],
  },
  {
    heading: "Combat & Placement Arrows",
    get description() {
      return i18n._(msg`Curved arrows for attack / block declarations and the placement ghost.`);
    },
    prefixes: ["arrow."],
  },
  {
    heading: "Targeting Pointers",
    get description() {
      return i18n._(
        msg`Per-intent pointer icon glow (sacrifice, destroy, exile, bounce, tap \u2026).`,
      );
    },
    prefixes: ["pointer."],
  },
  {
    heading: "Mana Symbols",
    get description() {
      return i18n._(msg`W / U / B / R / G / C pip and tap-button tints.`);
    },
    prefixes: ["mana."],
  },
  {
    heading: "Card Status Badges",
    get description() {
      return i18n._(msg`Exerted, morph, bestow, token, transformed, plotted, madness, warped.`);
    },
    prefixes: ["cardStatus."],
  },
  {
    heading: "Counters",
    get description() {
      return i18n._(msg`Per-counter-type chip colour (P1P1, M1M1, Loyalty, Charge \u2026).`);
    },
    prefixes: ["counter."],
  },
  {
    heading: "P / T Badge",
    get description() {
      return i18n._(msg`Neutral / lethal / buffed / debuffed stat-badge backgrounds.`);
    },
    prefixes: ["pt."],
  },
  {
    heading: "Status Signals",
    get description() {
      return i18n._(
        msg`Generic UI states: success (connected / win), poison counter, life / heart.`,
      );
    },
    exactKeys: ["success", "poison", "life"],
  },
  {
    heading: "Canvas",
    get description() {
      return i18n._(msg`Pixi table background, shadow ink, and high-contrast neutral.`);
    },
    prefixes: ["canvas."],
  },
  {
    heading: "Card Placeholder",
    get description() {
      return i18n._(msg`Sprite fill / stroke used while a card's image is loading.`);
    },
    prefixes: ["cardPlaceholder."],
  },
  {
    heading: "Text Roles",
    get description() {
      return i18n._(
        msg`Generic text colours on tinted chips, empty zones, and ghost placeholders.`,
      );
    },
    exactKeys: ["textOnTinted", "textMuted", "textGhost"],
  },
  {
    heading: "Player Colours",
    get description() {
      return i18n._(msg`Per-seat colours for phase strip indicators and turn tint.`);
    },
    prefixes: ["playerColors."],
  },
  {
    heading: "Badges",
    get description() {
      return i18n._(msg`Status chip icon colours rendered next to the mana pool.`);
    },
    prefixes: ["badges."],
  },
  {
    heading: "Card Ring",
    get description() {
      return i18n._(msg`Fallback ring / selection halo colour.`);
    },
    exactKeys: ["cardRing"],
  },
];
const FLASH_MIN = 200;
const FLASH_MAX = 2000;
const FLASH_STEP = 100;
export default function Settings() {
  const isGameActive = useGameStore((s) => s.isGameActive);
  const assetsTabAvailable = useAssetsAvailable();
  const prefs = usePreferencesStore();
  const { flashDurationMs, setFlashDurationMs } = prefs;
  const server = useServerStore();
  const { theme, setTheme, resolvedTheme } = useColorMode();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<
    "server" | "preferences" | "theme" | "prompts" | "keybindings" | "cache" | "account" | "assets"
  >(() =>
    location.state?.settingsTab === "account" && isFeatureEnabled("accounts")
      ? "account"
      : "preferences",
  );
  const accountTabRequested =
    location.state?.settingsTab === "account" && isFeatureEnabled("accounts");
  const [accountTabHandled, setAccountTabHandled] = useState(accountTabRequested);
  if (accountTabRequested !== accountTabHandled) {
    setAccountTabHandled(accountTabRequested);
    if (accountTabRequested) setActiveTab("account");
  }
  const [clearingCache, setClearingCache] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [editingThemeColorPath, setEditingThemeColorPath] = useState<string | null>(null);
  const [editingThemeColorValue, setEditingThemeColorValue] = useState("");
  const [themeColorFilter, setThemeColorFilter] = useState("");
  const DEFAULT_GAME_THEME_COLOR_MAP = getDefaultGameThemeColorMap();
  const zoneOrder = prefs.zonePanelOrder;
  const [playmatEditorOpen, setPlaymatEditorOpen] = useState(false);
  const defaultPlaymat = useAssetUrl(prefs.defaultPlaymatAssetId);
  const hasDefaultPlaymat = !!defaultPlaymat || !!prefs.defaultPlaymatSettings?.color;
  function setZoneSlot(index: number, value: ZonePanelItem) {
    const next = [...zoneOrder] as ZonePanelItem[];
    const existingIndex = next.indexOf(value);
    if (existingIndex !== -1 && existingIndex !== index) {
      const prevValue = next[index]!;
      next[index] = value;
      next[existingIndex] = prevValue;
    } else {
      next[index] = value;
    }
    prefs.setZonePanelOrder(next);
  }
  const [host, setHost] = useState(prefs.serverHost);
  const [port, setPort] = useState(String(prefs.serverPort));
  const [password, setPassword] = useState(prefs.serverPassword);
  const [savingServer, setSavingServer] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const hasChanges =
    host !== prefs.serverHost ||
    port !== String(prefs.serverPort) ||
    password !== prefs.serverPassword;
  function beginThemeColorEdit(path: string, value: string) {
    setEditingThemeColorPath(path);
    setEditingThemeColorValue(value);
  }
  function commitThemeColorEdit(path: string, fallbackValue: string) {
    const next = editingThemeColorValue.trim() || fallbackValue;
    prefs.setGameThemeColorOverride(path, next);
    setEditingThemeColorPath(null);
    setEditingThemeColorValue("");
  }
  async function handleSave() {
    prefs.setServerHost(host);
    prefs.setServerPort(Number(port));
    prefs.setServerPassword(password);
    // Always disconnect first (kills any existing WS connection)
    await server.disconnect();
    const name = relayUsername();
    if (name) {
      await server.connect(host, Number(port), name, password);
    }
  }
  async function applyKnownRelay(relay: KnownRelay) {
    setHost(relay.host);
    setPort(String(relay.port));
    setPassword(relay.password);
    prefs.setServerHost(relay.host);
    prefs.setServerPort(relay.port);
    prefs.setServerPassword(relay.password);
    await server.disconnect();
    const name = relayUsername();
    if (name) {
      await server.connect(relay.host, relay.port, name, relay.password);
    }
  }
  function saveCurrentServer() {
    const name = newServerName.trim();
    if (!name) return;
    if (KNOWN_RELAYS.some((r) => r.name === name)) {
      toast.error(i18n._(msg`That name is reserved for a built-in server`));
      return;
    }
    prefs.addSavedServer({ name, host, port: Number(port), password });
    setNewServerName("");
    setSavingServer(false);
    toast.success(i18n._(msg`Saved "${name}"`));
  }
  async function handleClearImageCache() {
    setClearingCache(true);
    try {
      useScryfallStore.getState().clearImageCaches();
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      toast.success(i18n._(msg`Image cache cleared \u2014 reloading\u2026`));
      window.location.reload();
    } catch {
      setClearingCache(false);
      toast.error(i18n._(msg`Couldn't clear the image cache`));
    }
  }
  if (isGameActive) {
    return <Navigate to="/play" replace />;
  }
  return (
    <div className="h-full space-y-8 overflow-y-auto px-4 py-8 sm:px-6 lg:px-8">
      <section className="space-y-4">
        <div className="flex items-center gap-6 border-b overflow-x-auto no-scrollbar">
          {isFeatureEnabled("accounts") && (
            <button
              type="button"
              onClick={() => setActiveTab("account")}
              className={
                "pb-2 text-sm font-medium transition-colors border-b-2 shrink-0 whitespace-nowrap " +
                (activeTab === "account"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              <Trans>Account</Trans>
            </button>
          )}
          {assetsTabAvailable && (
            <button
              type="button"
              onClick={() => setActiveTab("assets")}
              className={
                "pb-2 text-sm font-medium transition-colors border-b-2 shrink-0 whitespace-nowrap " +
                (activeTab === "assets"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              <Trans>My assets</Trans>
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab("preferences")}
            className={
              "pb-2 text-sm font-medium transition-colors border-b-2 shrink-0 whitespace-nowrap " +
              (activeTab === "preferences"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            <Trans>Preferences</Trans>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("theme")}
            className={
              "pb-2 text-sm font-medium transition-colors border-b-2 shrink-0 whitespace-nowrap " +
              (activeTab === "theme"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            <Trans>Theme</Trans>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("prompts")}
            className={
              "pb-2 text-sm font-medium transition-colors border-b-2 shrink-0 whitespace-nowrap " +
              (activeTab === "prompts"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            <Trans>Prompts</Trans>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("keybindings")}
            className={
              "pb-2 text-sm font-medium transition-colors border-b-2 shrink-0 whitespace-nowrap " +
              (activeTab === "keybindings"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            <Trans>Shortcuts</Trans>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("server")}
            className={
              "pb-2 text-sm font-medium transition-colors border-b-2 shrink-0 whitespace-nowrap " +
              (activeTab === "server"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            <Trans>Server</Trans>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("cache")}
            className={
              "pb-2 text-sm font-medium transition-colors border-b-2 shrink-0 whitespace-nowrap " +
              (activeTab === "cache"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            <Trans>Cache</Trans>
          </button>
        </div>
      </section>

      {activeTab === "account" && isFeatureEnabled("accounts") && <AccountSection />}

      {activeTab === "assets" && <MyAssetsSection />}

      {activeTab === "keybindings" && <KeybindingsPanel />}

      {activeTab === "cache" && <CardArtDownloadSection />}

      {activeTab === "cache" && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            <Trans>Cache</Trans>
          </h2>
          <div className="rounded-lg border bg-card/40 p-4 space-y-3 max-w-xl">
            <Label>
              <Trans>Card Image Cache</Trans>
            </Label>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Drops Manabrew&apos;s in-memory card textures and image object URLs, clears the
                CacheStorage API, then reloads so every card image is fetched fresh. Use this if
                battlefield card art fails to appear. For a full browser HTTP cache wipe, use the
                browser&apos;s &quot;Empty Cache and Hard Reload&quot; (DevTools open → right-click
                reload).
              </Trans>
            </p>
            <Button
              variant="destructive"
              onClick={() => void handleClearImageCache()}
              disabled={clearingCache}
            >
              {clearingCache
                ? i18n._(msg`Clearing\u2026`)
                : i18n._(msg`Clear image cache & reload`)}
            </Button>
          </div>
        </section>
      )}

      {activeTab === "prompts" && <PromptPreferencesPanel />}

      {activeTab === "server" && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            <Trans>Server</Trans>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="server-host">
                <Trans>Host</Trans>
              </Label>
              <Input
                id="server-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder={i18n._(msg`localhost`)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="server-port">
                <Trans>Port</Trans>
              </Label>
              <Input
                id="server-port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="9443"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="server-password">
                <Trans>Password</Trans>
              </Label>
              <Input
                id="server-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={i18n._(msg`forge`)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={!hasChanges && !server.error}>
              <Trans>Save & Reconnect</Trans>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Trans>
                    <Server className="h-4 w-4" />
                    Saved servers
                  </Trans>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56">
                <DropdownMenuLabel>
                  <Trans>Built-in</Trans>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {KNOWN_RELAYS.map((relay) => (
                  <DropdownMenuItem key={relay.name} onSelect={() => void applyKnownRelay(relay)}>
                    <div className="flex flex-col">
                      <span className="text-sm">{relay.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {relay.host}:{relay.port}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
                {prefs.savedServers.length > 0 && (
                  <>
                    <DropdownMenuLabel>
                      <Trans>Your servers</Trans>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {prefs.savedServers.map((relay) => (
                      <DropdownMenuItem
                        key={relay.name}
                        onSelect={() => void applyKnownRelay(relay)}
                        className="justify-between gap-2"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm">{relay.name}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {relay.host}:{relay.port}
                          </span>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${relay.name}`}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            prefs.removeSavedServer(relay.name);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              onClick={() => {
                setNewServerName(host);
                setSavingServer((v) => !v);
              }}
            >
              <Trans>Save current server…</Trans>
            </Button>
            {server.connected && (
              <span className="text-xs text-success flex items-center gap-1">
                <Trans>
                  <span className="h-2 w-2 rounded-full bg-success" />
                  Connected as {server.username}
                </Trans>
              </span>
            )}
            {server.connecting && (
              <span className="text-xs text-muted-foreground">
                <Trans>Connecting...</Trans>
              </span>
            )}
            {server.error && <span className="text-xs text-destructive">{server.error}</span>}
          </div>
          {savingServer && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                autoFocus
                value={newServerName}
                onChange={(e) => setNewServerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCurrentServer();
                  if (e.key === "Escape") setSavingServer(false);
                }}
                placeholder={i18n._(msg`Name this server`)}
                className="max-w-xs"
              />
              <Button size="sm" onClick={saveCurrentServer} disabled={!newServerName.trim()}>
                <Trans>Save</Trans>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSavingServer(false)}>
                <Trans>Cancel</Trans>
              </Button>
              <span className="text-xs text-muted-foreground">
                <Trans>
                  Saves the current host, port, and password so you can switch back later.
                </Trans>
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            <Trans>
              Server connection settings. Saving will disconnect and reconnect with the new
              credentials.
            </Trans>
          </p>
        </section>
      )}

      {activeTab === "preferences" && (
        <section>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <LanguagePreferenceCard />

            <PreferenceCard
              title={i18n._(msg`Default Playmat`)}
              description={i18n._(
                msg`Used in games when the deck you're playing has no custom playmat of its own.`,
              )}
            >
              <div className="group relative">
                <button
                  type="button"
                  onClick={() => setPlaymatEditorOpen(true)}
                  title={hasDefaultPlaymat ? "Customize playmat" : "Set playmat"}
                  className={cn(
                    "flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border bg-muted",
                    "motion-safe:transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    !hasDefaultPlaymat && "border-dashed",
                  )}
                >
                  {defaultPlaymat ? (
                    <img
                      src={defaultPlaymat}
                      alt={i18n._(msg`Your default playmat`)}
                      crossOrigin="anonymous"
                      className="size-full object-cover"
                    />
                  ) : prefs.defaultPlaymatSettings?.color ? (
                    <span
                      className="size-full"
                      style={{ backgroundColor: prefs.defaultPlaymatSettings.color }}
                      aria-hidden
                    />
                  ) : (
                    <span className="flex size-12 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm motion-safe:transition-opacity opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                      <Plus className="h-6 w-6" />
                    </span>
                  )}
                </button>
                {hasDefaultPlaymat && (
                  <span className="pointer-events-none absolute -bottom-2 -right-2 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors group-hover:text-foreground">
                    <Pencil className="h-3 w-3" />
                  </span>
                )}
                {hasDefaultPlaymat && (
                  <button
                    type="button"
                    title={i18n._(msg`Remove playmat`)}
                    onClick={() => {
                      void useAssetStore.getState().remove(prefs.defaultPlaymatAssetId);
                      prefs.setDefaultPlaymatAssetId(undefined);
                      prefs.setDefaultPlaymatSettings(undefined);
                    }}
                    className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm motion-safe:transition-opacity opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring before:absolute before:-inset-2.5 before:content-['']"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                )}
              </div>
            </PreferenceCard>

            <PreferenceCard
              title={i18n._(msg`Battlefield Zone Column Order`)}
              description={i18n._(
                msg`Controls placement of Library / Graveyard / Exile in the in-field zone column.`,
              )}
            >
              <div className="grid grid-cols-3 gap-2">
                {(["Top", "Middle", "Bottom"] as const).map((slot, index) => (
                  <div key={slot} className="space-y-1">
                    <Label
                      htmlFor={`zone-order-${index}`}
                      className="text-xs text-muted-foreground"
                    >
                      {slot}
                    </Label>
                    <select
                      id={`zone-order-${index}`}
                      value={zoneOrder[index]}
                      onChange={(e) => setZoneSlot(index, e.target.value as ZonePanelItem)}
                      className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm pointer-coarse:text-base"
                    >
                      <option value="library">
                        <Trans>Library</Trans>
                      </option>
                      <option value="graveyard">
                        <Trans>Graveyard</Trans>
                      </option>
                      <option value="exile">
                        <Trans>Exile</Trans>
                      </option>
                    </select>
                  </div>
                ))}
              </div>
            </PreferenceCard>

            <PreferenceCard
              title={i18n._(msg`Card Size`)}
              value={`${Math.round(prefs.cardSizeMultiplier * 100)}%`}
              description={i18n._(
                msg`Scales cards on every battlefield and your hand fan. 100% is the classic 3-row board; battlefield cards cap at a 2-row fill so the board stays playable, while the hand keeps growing past them.`,
              )}
            >
              <div className="flex items-start gap-4">
                <div className="flex-1 space-y-3">
                  <input
                    type="range"
                    min={Math.round(CARD_SIZE_MULTIPLIER_MIN * 100)}
                    max={Math.round(CARD_SIZE_MULTIPLIER_MAX * 100)}
                    step={5}
                    value={Math.round(prefs.cardSizeMultiplier * 100)}
                    onChange={(e) => prefs.setCardSizeMultiplier(Number(e.target.value) / 100)}
                    className="w-full accent-primary"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => prefs.setCardSizeMultiplier(CARD_SIZE_MULTIPLIER_MIN)}
                    >
                      75%
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => prefs.setCardSizeMultiplier(1)}
                    >
                      100%
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => prefs.setCardSizeMultiplier(CARD_SIZE_MULTIPLIER_MAX)}
                    >
                      150%
                    </Button>
                  </div>
                </div>
                <div className="w-[120px] shrink-0 flex justify-center">
                  <BattlefieldStylePreview
                    style={prefs.battlefieldCardStyle}
                    width={Math.round(
                      48 +
                        ((prefs.cardSizeMultiplier - CARD_SIZE_MULTIPLIER_MIN) /
                          (CARD_SIZE_MULTIPLIER_MAX - CARD_SIZE_MULTIPLIER_MIN)) *
                          72,
                    )}
                  />
                </div>
              </div>
            </PreferenceCard>
            <PreferenceCard
              title={i18n._(msg`Hand Ordering`)}
              description={i18n._(
                msg`Drag cards sideways for a custom order, or keep every hand sorted automatically by color or mana value.`,
              )}
            >
              <div className="flex flex-wrap gap-2">
                {HAND_ORDER_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    variant={prefs.handOrderMode === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setHandOrderMode(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </PreferenceCard>

            <PreferenceCard
              title={i18n._(msg`Battlefield Layout`)}
              description={
                '"Free placement" lets you drag cards anywhere. "Auto-arrange" keeps the battlefield tidy in rows (creatures, then others, then lands) and ignores manual placement.'
              }
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={!prefs.battlefieldAutoSort ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setBattlefieldAutoSort(false)}
                >
                  <Trans>Free placement</Trans>
                </Button>
                <Button
                  variant={prefs.battlefieldAutoSort ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setBattlefieldAutoSort(true)}
                >
                  <Trans>Auto-arrange</Trans>
                </Button>
              </div>
            </PreferenceCard>

            <PreferenceCard
              title={i18n._(msg`Zone Piles`)}
              description={
                '"Locked" keeps the deck, graveyard, exile, and command piles fixed on the battlefield so a drag can\'t move them. Tapping to open still works.'
              }
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={!prefs.lockZoneTiles ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setLockZoneTiles(false)}
                >
                  <Trans>Movable</Trans>
                </Button>
                <Button
                  variant={prefs.lockZoneTiles ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setLockZoneTiles(true)}
                >
                  <Trans>Locked</Trans>
                </Button>
              </div>
            </PreferenceCard>

            <PreferenceCard
              title={i18n._(msg`Battlefield Card Style`)}
              description={
                '"Realistic" uses the full printed card image. "Art-forward" shows the art with a crisp name/type overlay. "Mini-frame" frames the art with name and type bars. This setting only affects battlefield cards.'
              }
            >
              <div className="flex items-start gap-4">
                <div className="flex-1 flex flex-wrap content-start gap-2">
                  <Button
                    variant={prefs.battlefieldCardStyle === "realistic" ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setBattlefieldCardStyle("realistic")}
                  >
                    <Trans>Realistic</Trans>
                  </Button>
                  <Button
                    variant={prefs.battlefieldCardStyle === "art" ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setBattlefieldCardStyle("art")}
                  >
                    <Trans>Art-forward</Trans>
                  </Button>
                  <Button
                    variant={prefs.battlefieldCardStyle === "frame" ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setBattlefieldCardStyle("frame")}
                  >
                    <Trans>Mini-frame</Trans>
                  </Button>
                </div>
                <BattlefieldStylePreview style={prefs.battlefieldCardStyle} />
              </div>
            </PreferenceCard>

            <PreferenceCard
              title={i18n._(msg`In-game Animations`)}
              description={i18n._(
                msg`Decorative board effects \u2014 creature entrance stomp + dust, stat and damage pops, glow pulses. Turn these off to save performance on weaker hardware; the board still works (cards move, state indicators and damage numbers stay).`,
              )}
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={prefs.inGameAnimations ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setInGameAnimations(true)}
                >
                  <Trans>On</Trans>
                </Button>
                <Button
                  variant={!prefs.inGameAnimations ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setInGameAnimations(false)}
                >
                  <Trans>Off</Trans>
                </Button>
              </div>
            </PreferenceCard>

            {isFeatureEnabled("ironsmithRuntime") && IRONSMITH_WASM_AVAILABLE && (
              <PreferenceCard
                title={i18n._(msg`Ironsmith engine (experimental)`)}
                description={i18n._(
                  msg`Adds the experimental Ironsmith trusted engine as a Create Room option. Card support is partial and games may be rough \u2014 off by default. Leave this off unless you're testing Ironsmith.`,
                )}
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={prefs.ironsmithRuntimeEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setIronsmithRuntimeEnabled(true)}
                  >
                    <Trans>On</Trans>
                  </Button>
                  <Button
                    variant={!prefs.ironsmithRuntimeEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setIronsmithRuntimeEnabled(false)}
                  >
                    <Trans>Off</Trans>
                  </Button>
                </div>
              </PreferenceCard>
            )}

            <PreferenceCard
              title={i18n._(msg`Peer to Peer`)}
              description={i18n._(
                msg`Skip manabrew servers and connect directly to the other players at the table. This shares your IP address with the people you play with, and only activates if every player in the game has it enabled.`,
              )}
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={prefs.directTransport ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setDirectTransport(true)}
                >
                  <Trans>On</Trans>
                </Button>
                <Button
                  variant={!prefs.directTransport ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setDirectTransport(false)}
                >
                  <Trans>Off</Trans>
                </Button>
              </div>
            </PreferenceCard>

            <PreferenceCard
              title={i18n._(msg`Hand Card Style`)}
              description={i18n._(
                msg`Printed card shows the card image. Dynamic view uses the card's current rules and game state; each card can still be switched.`,
              )}
            >
              <div className="flex flex-wrap gap-2">
                {INLINE_CARD_STYLE_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    variant={prefs.handCardStyle === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setHandCardStyle(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </PreferenceCard>

            <PreferenceCard
              title={i18n._(msg`Default Stack Card View`)}
              description={i18n._(
                msg`Choose which face stack cards show when they appear. You can still switch individual cards.`,
              )}
            >
              <div className="flex flex-wrap gap-2">
                {INLINE_CARD_STYLE_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    variant={prefs.stackCardStyle === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setStackCardStyle(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </PreferenceCard>

            <PreferenceCard
              title={i18n._(msg`Card Preview Style`)}
              description={i18n._(
                msg`Printed card shows the full card image. Dynamic view prioritizes current rules, actions, costs, counters, and other game state.`,
              )}
            >
              <div className="flex flex-wrap gap-2">
                {IN_GAME_CARD_PREVIEW_STYLE_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    variant={prefs.inGameCardPreviewStyle === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setInGameCardPreviewStyle(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </PreferenceCard>

            <PreferenceCard
              title={i18n._(msg`Flash duration`)}
              value={`${flashDurationMs}ms`}
              description={i18n._(msg`Card-play and turn-start flash duration.`)}
            >
              <input
                type="range"
                min={FLASH_MIN}
                max={FLASH_MAX}
                step={FLASH_STEP}
                value={flashDurationMs}
                onChange={(e) => setFlashDurationMs(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </PreferenceCard>
          </div>
          {playmatEditorOpen && (
            <PlaymatEditorModal
              onClose={() => setPlaymatEditorOpen(false)}
              title={i18n._(msg`Default Playmat`)}
              playmat={defaultPlaymat}
              storedSettings={prefs.defaultPlaymatSettings}
              playmatAssetId={prefs.defaultPlaymatAssetId}
              setPlaymat={(_url, assetId) => prefs.setDefaultPlaymatAssetId(assetId)}
              setPlaymatSettings={prefs.setDefaultPlaymatSettings}
            />
          )}
        </section>
      )}

      {activeTab === "theme" && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            <Trans>Theme</Trans>
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-card/40 p-4 space-y-2">
              <Label>
                <Trans>App Theme</Trans>
              </Label>
              <div className="flex items-center gap-2">
                <Button
                  variant={theme === "light" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme("light")}
                >
                  <Trans>Light</Trans>
                </Button>
                <Button
                  variant={theme === "dark" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme("dark")}
                >
                  <Trans>Dark</Trans>
                </Button>
                <Button
                  variant={theme === "system" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme("system")}
                >
                  <Trans>System</Trans>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <Trans>Controls app theme preference.</Trans>
              </p>
            </div>

            <div className="rounded-lg border bg-card/40 p-4 space-y-2">
              <Label>
                <Trans>Color Preset</Trans>
              </Label>
              {(() => {
                const active = THEME_PRESETS.find((p) => p.id === prefs.appThemePreset);
                const mode = resolvedTheme === "dark" ? "dark" : "light";
                return (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setPresetOpen((v) => !v)}
                      className="w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
                    >
                      {active && (
                        <div className="flex gap-1 shrink-0">
                          {[
                            active[mode].background,
                            active[mode].primary,
                            active[mode].accent,
                            active[mode].destructive,
                          ].map((hsl, i) => (
                            <div
                              key={i}
                              className="w-4 h-4 rounded-full border border-border/50"
                              style={{ backgroundColor: hsl }}
                            />
                          ))}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{active?.name ?? "Select preset"}</div>
                      </div>
                      <svg
                        className="h-4 w-4 text-muted-foreground shrink-0"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M4 6l4 4 4-4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    {presetOpen && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg max-h-[min(16rem,50dvh)] overflow-y-auto">
                        {THEME_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              prefs.setAppThemePreset(preset.id);
                              setPresetOpen(false);
                            }}
                            className={
                              "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 " +
                              (prefs.appThemePreset === preset.id ? "bg-primary/5" : "")
                            }
                          >
                            <div className="flex gap-1 shrink-0">
                              {[
                                preset[mode].background,
                                preset[mode].primary,
                                preset[mode].accent,
                                preset[mode].destructive,
                              ].map((hsl, i) => (
                                <div
                                  key={i}
                                  className="w-3.5 h-3.5 rounded-full border border-border/50"
                                  style={{ backgroundColor: hsl }}
                                />
                              ))}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium">{preset.name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {preset.description}
                              </div>
                            </div>
                            {prefs.appThemePreset === preset.id && (
                              <div className="text-[10px] text-primary font-medium shrink-0">
                                <Trans>Active</Trans>
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                <Trans>Choose a color preset. Works with both light and dark modes.</Trans>
              </p>
            </div>
          </div>

          <div className="pt-2">
            <Input
              placeholder={i18n._(msg`Filter colors... (e.g. primary, counter, arrow)`)}
              value={themeColorFilter}
              onChange={(e) => setThemeColorFilter(e.target.value)}
              className="max-w-sm"
            />
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between gap-2">
              <Label>
                <Trans>App Theme Colors</Trans>
              </Label>
              <Button
                size="sm"
                variant="outline"
                onClick={prefs.resetAppThemeColorOverrides}
                disabled={Object.keys(prefs.appThemeColorOverrides).length === 0}
              >
                <Trans>Reset Colors</Trans>
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {APP_THEME_GROUPS.map((group) => {
                const activePreset = THEME_PRESETS.find((p) => p.id === prefs.appThemePreset);
                const mode = resolvedTheme === "dark" ? "dark" : "light";
                const q = themeColorFilter.toLowerCase();
                const filteredKeys = q
                  ? group.keys.filter(
                      (k) =>
                        k.toLowerCase().includes(q) ||
                        (APP_THEME_COLOR_LABELS[k] ?? "").toLowerCase().includes(q) ||
                        group.heading.toLowerCase().includes(q),
                    )
                  : group.keys;
                if (filteredKeys.length === 0) return null;
                return (
                  <div key={group.heading} className="rounded-lg border bg-card/40 p-4 space-y-1.5">
                    <div className="flex items-baseline gap-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.heading}
                      </h4>
                      <span className="text-[10px] text-muted-foreground/70">
                        {group.description}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {filteredKeys.map((key) => {
                        const presetValue = activePreset?.[mode]?.[key as keyof ThemeColors] ?? "";
                        const activeValue = prefs.appThemeColorOverrides[key] ?? presetValue;
                        return (
                          <div
                            key={key}
                            className="flex flex-col gap-1 rounded-md border px-2 py-1.5 min-w-0"
                          >
                            <Label className="text-xs font-mono break-words flex items-center gap-1">
                              <span>{APP_THEME_COLOR_LABELS[key] ?? key}</span>
                              <HelpMark description={APP_THEME_COLOR_DESCRIPTIONS[key]} />
                            </Label>
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="color"
                                value={activeValue}
                                onChange={(e) =>
                                  prefs.setAppThemeColorOverride(key, e.target.value)
                                }
                                className="h-8 w-10 shrink-0 rounded border border-input bg-transparent p-0.5"
                              />
                              <button
                                type="button"
                                className="flex-1 min-w-0 text-right text-[11px] font-mono text-muted-foreground hover:text-foreground underline-offset-2 hover:underline truncate"
                                onClick={() => beginThemeColorEdit(`app.${key}`, activeValue)}
                                title={i18n._(msg`Click to edit color value`)}
                              >
                                {activeValue}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              <Trans>Override individual colors from the active preset.</Trans>
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between gap-2">
              <Label>
                <Trans>Game Theme Colors</Trans>
              </Label>
              <Button size="sm" variant="outline" onClick={prefs.resetGameThemeColorOverrides}>
                <Trans>Reset Colors</Trans>
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(() => {
                const allPaths = Object.keys(DEFAULT_GAME_THEME_COLOR_MAP);
                const grouped = new Set<string>();
                const groups = GAME_THEME_GROUPS.map((g) => {
                  const keys: string[] = [];
                  if (g.prefixes) {
                    for (const prefix of g.prefixes) {
                      for (const path of allPaths) {
                        if (path.startsWith(prefix) && !grouped.has(path)) {
                          keys.push(path);
                          grouped.add(path);
                        }
                      }
                    }
                  }
                  if (g.exactKeys) {
                    for (const path of g.exactKeys) {
                      if (path in DEFAULT_GAME_THEME_COLOR_MAP && !grouped.has(path)) {
                        keys.push(path);
                        grouped.add(path);
                      }
                    }
                  }
                  return { ...g, keys };
                });
                const miscKeys = allPaths.filter((p) => !grouped.has(p));
                if (miscKeys.length > 0) {
                  groups.push({
                    heading: "Other",
                    get description() {
                      return i18n._(msg`Tokens not covered by the groups above.`);
                    },
                    keys: miscKeys,
                  });
                }
                const q = themeColorFilter.toLowerCase();
                return groups
                  .map((g) => {
                    const filtered = q
                      ? g.keys.filter(
                          (k) => k.toLowerCase().includes(q) || g.heading.toLowerCase().includes(q),
                        )
                      : g.keys;
                    return { ...g, keys: filtered };
                  })
                  .filter((g) => g.keys.length > 0)
                  .map((group) => (
                    <div
                      key={group.heading}
                      className="rounded-lg border bg-card/40 p-4 space-y-1.5"
                    >
                      <div className="flex items-baseline gap-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {group.heading}
                        </h4>
                        <span className="text-[10px] text-muted-foreground/70">
                          {group.description}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {group.keys.map((path) => {
                          const defaultColor = DEFAULT_GAME_THEME_COLOR_MAP[path] ?? "";
                          const activeColor = prefs.gameThemeColorOverrides[path] ?? defaultColor;
                          return (
                            <div
                              key={path}
                              className="flex flex-col gap-1 rounded-md border px-2 py-1.5 min-w-0"
                            >
                              <Label
                                htmlFor={`theme-color-${path}`}
                                className="text-xs font-mono break-words flex items-center gap-1"
                              >
                                <span>{path}</span>
                                <HelpMark
                                  description={GAME_THEME_COLOR_DESCRIPTIONS[path as GameThemePath]}
                                />
                              </Label>
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  id={`theme-color-${path}`}
                                  type="color"
                                  value={toPickerHexColor(activeColor)}
                                  onChange={(e) =>
                                    prefs.setGameThemeColorOverride(path, e.target.value)
                                  }
                                  className="h-8 w-10 shrink-0 rounded border border-input bg-transparent p-0.5"
                                />
                                {editingThemeColorPath === path ? (
                                  <input
                                    autoFocus
                                    value={editingThemeColorValue}
                                    onChange={(e) => setEditingThemeColorValue(e.target.value)}
                                    onBlur={() => commitThemeColorEdit(path, defaultColor)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        commitThemeColorEdit(path, defaultColor);
                                      }
                                      if (e.key === "Escape") {
                                        setEditingThemeColorPath(null);
                                        setEditingThemeColorValue("");
                                      }
                                    }}
                                    className="flex-1 min-w-0 h-7 rounded border border-input bg-background px-1.5 text-right text-[11px] font-mono"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="flex-1 min-w-0 text-right text-[11px] font-mono text-muted-foreground hover:text-foreground underline-offset-2 hover:underline truncate"
                                    onClick={() => beginThemeColorEdit(path, activeColor)}
                                    title={i18n._(msg`Click to edit color value`)}
                                  >
                                    {activeColor}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
              })()}
            </div>
            <p className="text-xs text-muted-foreground">
              <Trans>Generated from game theme keys. Defaults come from the active preset.</Trans>
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
