import { useState } from "react";
import { usePreferencesStore, type ZonePanelItem } from "@/stores/usePreferencesStore";
import { THEME_PRESETS, type ThemeColors } from "@/themes";
import { useServerStore } from "@/stores/useServerStore";
import { useGameStore } from "@/stores/useGameStore";
import { PromptPreferencesPanel } from "@/components/game/prompts/PromptPreferencesPanel";
import { toPickerHexColor } from "@/themes/gameTheme";
import type { GameThemeColors } from "@/themes/gameTheme";
import { getDefaultGameThemeColorMap } from "@/hooks/useTheme";
import { useBattlefieldCardScale } from "@/hooks/useBattlefieldCardScale";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTheme as useColorMode } from "next-themes";
import { Navigate } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Production builds set VITE_MANAGED_RELAY=1; the relay host/port/password
 * are baked into the bundle and shouldn't be editable. Username stays
 * configurable because each player still picks their own handle.
 */
const MANAGED_RELAY = !!import.meta.env.VITE_MANAGED_RELAY;

/** Human-readable labels for theme color keys */
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

/** Human-readable description for each Radix (app chrome) colour token.
 *  Shown as the `title` attribute of a small `?` icon next to the label. */
const APP_THEME_COLOR_DESCRIPTIONS: Record<AppThemeKey, string> = {
  background: "Page / window background fill.",
  foreground: "Default body text colour.",
  card: "Surface colour for cards, panels, and solid containers.",
  "card-foreground": "Text colour placed on `card` surfaces.",
  popover: "Background of popovers, menus, and floating panels.",
  "popover-foreground": "Text colour inside popovers.",
  primary: "Primary action colour — main call-to-action buttons, links, active chip fills.",
  "primary-foreground": "Text / icons placed on a `primary` background.",
  secondary: "Secondary / subtle button background.",
  "secondary-foreground": "Text on secondary-style buttons.",
  muted: "Muted surface for low-priority regions.",
  "muted-foreground": "Captions, hints, and secondary text colour.",
  accent: "Hover / active highlight surface.",
  "accent-foreground": "Text on accent surfaces.",
  destructive: "Destructive actions, errors, and deny states.",
  "destructive-foreground": "Text placed on `destructive` buttons.",
  border: "Default border and divider lines.",
  input: "Form input borders and backgrounds.",
  ring: "Focus ring around interactive elements.",
  selection: "Background of selected text.",
  "selection-foreground": "Colour of selected text itself.",
  commander: "Commander indicator (crown icon, commander panel accent).",
  warning: "Warning states and soft cautions.",
  overlay: "Modal / dialog backdrop dim.",
};

/** Human-readable description for each game-surface colour token.
 *  Keys are type-checked against the live `GameThemeColors` schema —
 *  a typo or renamed schema field fails compilation here. */
const GAME_THEME_COLOR_DESCRIPTIONS: Partial<Record<GameThemePath, string>> = {
  "activeAction.priority": "Highlight surrounding the player who currently has priority.",
  "activeAction.active": "Active-turn ring, turn-text colour, and general 'your turn' cue.",
  "promptAction.passAction": "Pass priority / pass turn button fill.",
  "promptAction.attackAction": "Declare-attackers button fill.",
  "promptAction.defenseAction": "Defense / declare-blockers button fill.",
  "promptAction.cancel": "Cancel / decline button fill.",
  "arrow.attack": "Attacker arrow from attacker to defender.",
  "arrow.block": "Blocker arrow from blocker to attacker.",
  "arrow.hostileTarget": "Legacy hostile-target arrow (Pixi fallback).",
  "arrow.friendlyTarget": "Legacy friendly-target arrow (Pixi fallback).",
  "pointer.hostile":
    "Glow around the cursor for hostile targeting — damage, destroy, sacrifice, exile, counter, etc. Also used for the mulligan-reject ring.",
  "pointer.friendly":
    "Glow around the cursor for friendly / supportive targeting — buff, heal, draw, reveal, untap, attach, copy.",
  "mana.W": "White mana pip and dual-land tap-button tint.",
  "mana.U": "Blue mana pip and dual-land tap-button tint.",
  "mana.B": "Black mana pip and dual-land tap-button tint.",
  "mana.R": "Red mana pip and dual-land tap-button tint.",
  "mana.G": "Green mana pip and dual-land tap-button tint.",
  "mana.C": "Colorless mana pip and tap-button tint.",
  "cardStatus.exerted": "Badge colour for exerted creatures (won't untap).",
  "cardStatus.morph": "Badge for face-down / morph creatures.",
  "cardStatus.bestow": "Badge for bestowed auras.",
  "cardStatus.token": "Badge for token creatures.",
  "cardStatus.transformed": "Badge for transformed double-faced cards.",
  "cardStatus.plotted": "Badge for plotted cards in exile.",
  "cardStatus.madness": "Badge for madness-exiled cards.",
  "cardStatus.warped": "Badge for warp-exiled cards.",
  "cardStatus.copy": "Badge for permanents that are copies of another card.",
  "counter.default": "Fallback chip colour for unknown counter types.",
  "counter.p1p1": "+1/+1 counter chip.",
  "counter.m1m1": "-1/-1 counter chip.",
  "counter.loyalty": "Loyalty counter chip (planeswalkers).",
  "counter.charge": "Charge counter chip.",
  "counter.quest": "Quest counter chip.",
  "counter.study": "Study counter chip.",
  "counter.lore": "Lore counter chip (sagas).",
  "counter.age": "Age counter chip.",
  "counter.time": "Time counter chip (suspend, etc.).",
  "counter.fade": "Fade counter chip.",
  "counter.level": "Level counter chip (level-up creatures).",
  "counter.storage": "Storage counter chip.",
  "counter.mining": "Mining counter chip.",
  "counter.brick": "Brick counter chip.",
  "counter.depletion": "Depletion counter chip.",
  "counter.page": "Page counter chip (book rooms).",
  "pt.neutral": "P/T badge when stats match the printed base.",
  "pt.lethal": "P/T badge when incoming damage would be lethal.",
  "pt.buffed": "P/T badge when stats are above the printed base.",
  "pt.debuffed": "P/T badge when stats are below the printed base.",
  success: "Positive states — connected, saved, victory banner, good FPS.",
  poison: "Poison counter / skull icon — MTG infect-green.",
  life: "Life total / heart icon.",
  "canvas.background": "Pixi canvas table background fill.",
  "canvas.shadow": "Drop-shadow ink (almost always black).",
  "canvas.neutral": "High-contrast stroke / outline colour for arrows and icons.",
  "cardPlaceholder.fill": "Loading-state card sprite fill.",
  "cardPlaceholder.stroke": "Loading-state card sprite border.",
  textOnTinted: "Text colour placed on tinted chips and badges.",
  textMuted: "Subdued label colour on empty-zone placeholders.",
  textGhost: "Ghost card-name colour shown while art loads.",
  cardRing: "Default card selection / focus ring.",
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
  background: "Background",
  foreground: "Text",
  card: "Card Surface",
  "card-foreground": "Card Text",
  popover: "Popover Surface",
  "popover-foreground": "Popover Text",
  primary: "Primary",
  "primary-foreground": "Primary Text",
  secondary: "Secondary",
  "secondary-foreground": "Secondary Text",
  muted: "Muted Surface",
  "muted-foreground": "Muted Text",
  accent: "Accent",
  "accent-foreground": "Accent Text",
  destructive: "Destructive",
  "destructive-foreground": "Destructive Text",
  border: "Border",
  input: "Input",
  ring: "Focus Ring",
  selection: "Selection",
  "selection-foreground": "Selection Text",
  commander: "Commander",
  warning: "Warning",
  overlay: "Overlay",
};

/** Group the app-chrome Radix tokens by semantic role so the picker
 *  reads like "surfaces → brand → state → structure" instead of a
 *  flat list ordered by schema declaration. */
const APP_THEME_GROUPS: { heading: string; description: string; keys: AppThemeKey[] }[] = [
  {
    heading: "Surfaces & Foregrounds",
    description: "Neutral page, card, and popover backgrounds plus their paired text colours.",
    keys: ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground"],
  },
  {
    heading: "Brand & Accent",
    description: "Primary action colour and the softer accent / secondary tints.",
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
    description: "Destructive, warning, commander, and selection highlights.",
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
    description: "Subdued surfaces, borders, input fields, focus ring, and overlay dim.",
    keys: ["muted", "muted-foreground", "border", "input", "ring", "overlay"],
  },
];

/** Group the game-surface tokens by prefix so related entries sit
 *  together (all `pointer.*` in one block, all `counter.*` in another,
 *  …). Keys are matched by prefix; anything not covered falls into
 *  the "Miscellaneous" group at the end. */
const GAME_THEME_GROUPS: {
  heading: string;
  description: string;
  prefixes?: string[];
  exactKeys?: string[];
}[] = [
  {
    heading: "Active Action",
    description: "Priority ring, turn glow, and related active-state cues.",
    prefixes: ["activeAction."],
  },
  {
    heading: "Prompt Buttons",
    description: "Pass, attack, defense, cancel, and related prompt action buttons.",
    prefixes: ["promptAction."],
  },
  {
    heading: "Combat & Placement Arrows",
    description: "Curved arrows for attack / block declarations and the placement ghost.",
    prefixes: ["arrow."],
  },
  {
    heading: "Targeting Pointers",
    description: "Per-intent pointer icon glow (sacrifice, destroy, exile, bounce, tap …).",
    prefixes: ["pointer."],
  },
  {
    heading: "Mana Symbols",
    description: "W / U / B / R / G / C pip and tap-button tints.",
    prefixes: ["mana."],
  },
  {
    heading: "Card Status Badges",
    description: "Exerted, morph, bestow, token, transformed, plotted, madness, warped.",
    prefixes: ["cardStatus."],
  },
  {
    heading: "Counters",
    description: "Per-counter-type chip colour (P1P1, M1M1, Loyalty, Charge …).",
    prefixes: ["counter."],
  },
  {
    heading: "P / T Badge",
    description: "Neutral / lethal / buffed / debuffed stat-badge backgrounds.",
    prefixes: ["pt."],
  },
  {
    heading: "Status Signals",
    description: "Generic UI states: success (connected / win), poison counter, life / heart.",
    exactKeys: ["success", "poison", "life"],
  },
  {
    heading: "Canvas",
    description: "Pixi table background, shadow ink, and high-contrast neutral.",
    prefixes: ["canvas."],
  },
  {
    heading: "Card Placeholder",
    description: "Sprite fill / stroke used while a card's image is loading.",
    prefixes: ["cardPlaceholder."],
  },
  {
    heading: "Text Roles",
    description: "Generic text colours on tinted chips, empty zones, and ghost placeholders.",
    exactKeys: ["textOnTinted", "textMuted", "textGhost"],
  },
  {
    heading: "Player Colours",
    description: "Per-seat colours for phase strip indicators and turn tint.",
    prefixes: ["playerColors."],
  },
  {
    heading: "Badges",
    description: "Status chip icon colours rendered next to the mana pool.",
    prefixes: ["badges."],
  },
  {
    heading: "Card Ring",
    description: "Fallback ring / selection halo colour.",
    exactKeys: ["cardRing"],
  },
];

const FLASH_MIN = 200;
const FLASH_MAX = 2000;
const FLASH_STEP = 100;

const HOVER_DELAY_MIN = 100;
const HOVER_DELAY_MAX = 1500;
const HOVER_DELAY_STEP = 50;
export default function Settings() {
  const isGameActive = useGameStore((s) => s.isGameActive);
  const prefs = usePreferencesStore();
  const { fraction: battlefieldSizeFraction, setFraction: setBattlefieldSizeFraction } =
    useBattlefieldCardScale();
  const { flashDurationMs, setFlashDurationMs } = prefs;
  const server = useServerStore();
  const { theme, setTheme, resolvedTheme } = useColorMode();
  const [activeTab, setActiveTab] = useState<"server" | "preferences" | "theme" | "prompts">(
    "preferences",
  );
  const [presetOpen, setPresetOpen] = useState(false);
  const [editingThemeColorPath, setEditingThemeColorPath] = useState<string | null>(null);
  const [editingThemeColorValue, setEditingThemeColorValue] = useState("");
  const [themeColorFilter, setThemeColorFilter] = useState("");
  const DEFAULT_GAME_THEME_COLOR_MAP = getDefaultGameThemeColorMap();

  const zoneOrder = prefs.zonePanelOrder;

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
  const [username, setUsername] = useState(prefs.serverUsername);
  const [password, setPassword] = useState(prefs.serverPassword);

  const hasChanges =
    host !== prefs.serverHost ||
    port !== String(prefs.serverPort) ||
    username !== prefs.serverUsername ||
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
    prefs.setServerUsername(username);
    prefs.setServerPassword(password);

    // Always disconnect first (kills any existing WS connection)
    await server.disconnect();

    if (username) {
      await server.connect(host, Number(port), username, password);
    }
  }

  if (isGameActive) {
    return <Navigate to="/play" replace />;
  }

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 lg:px-8 space-y-8">
      <h1 className="text-2xl font-bold">Preferences</h1>

      <section className="space-y-4">
        <div className="flex items-center gap-6 border-b">
          <button
            type="button"
            onClick={() => setActiveTab("preferences")}
            className={
              "pb-2 text-sm font-medium transition-colors border-b-2 " +
              (activeTab === "preferences"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            Preferences
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("theme")}
            className={
              "pb-2 text-sm font-medium transition-colors border-b-2 " +
              (activeTab === "theme"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            Theme
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("prompts")}
            className={
              "pb-2 text-sm font-medium transition-colors border-b-2 " +
              (activeTab === "prompts"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            Prompts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("server")}
            className={
              "pb-2 text-sm font-medium transition-colors border-b-2 " +
              (activeTab === "server"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            Server
          </button>
        </div>
      </section>

      {activeTab === "prompts" && <PromptPreferencesPanel />}

      {activeTab === "server" && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Server</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!MANAGED_RELAY && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="server-host">Host</Label>
                  <Input
                    id="server-host"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="localhost"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="server-port">Port</Label>
                  <Input
                    id="server-port"
                    type="number"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="9443"
                  />
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label htmlFor="server-username">Username</Label>
              <Input
                id="server-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Player1"
              />
            </div>
            {!MANAGED_RELAY && (
              <div className="space-y-1">
                <Label htmlFor="server-password">Password</Label>
                <Input
                  id="server-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="forge"
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={!hasChanges && !server.error}>
              Save & Reconnect
            </Button>
            {server.connected && (
              <span className="text-xs text-success flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-success" />
                Connected as {server.username}
              </span>
            )}
            {server.connecting && (
              <span className="text-xs text-muted-foreground">Connecting...</span>
            )}
            {server.error && <span className="text-xs text-destructive">{server.error}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            {MANAGED_RELAY
              ? "Relay host, port and credentials are managed by this deployment. Only your username is configurable here."
              : "Server connection settings. Saving will disconnect and reconnect with the new credentials."}
          </p>
        </section>
      )}

      {activeTab === "preferences" && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Preferences</h2>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg border bg-card/40 p-4 space-y-2">
              <Label>Battlefield Zone Column Order</Label>
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
                      className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="library">Library</option>
                      <option value="graveyard">Graveyard</option>
                      <option value="exile">Exile</option>
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Controls placement of Library / Graveyard / Exile in the in-field zone column.
              </p>
            </div>

            <div className="rounded-lg border bg-card/40 p-4 space-y-2">
              <Label>Battlefield Card Size ({Math.round(battlefieldSizeFraction * 100)}%)</Label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(battlefieldSizeFraction * 100)}
                onChange={(e) => setBattlefieldSizeFraction(Number(e.target.value) / 100)}
                className="w-full accent-primary"
              />
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setBattlefieldSizeFraction(0)}>
                  Smallest
                </Button>
                <Button variant="outline" size="sm" onClick={() => setBattlefieldSizeFraction(0.5)}>
                  Default
                </Button>
                <Button variant="outline" size="sm" onClick={() => setBattlefieldSizeFraction(1)}>
                  Largest
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Controls the size of cards on the battlefield. The largest setting still keeps at
                least 3 rows visible on any display.
              </p>
            </div>

            <div className="rounded-lg border bg-card/40 p-4 space-y-2">
              <Label>Card Preview Trigger</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant={prefs.cardPreviewMode === "hover" ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setCardPreviewMode("hover")}
                >
                  Hover
                </Button>
                <Button
                  variant={prefs.cardPreviewMode === "shift" ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setCardPreviewMode("shift")}
                >
                  Shift + Hover
                </Button>
                <Button
                  variant={prefs.cardPreviewMode === "alt" ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setCardPreviewMode("alt")}
                >
                  Alt + Hover
                </Button>
                <Button
                  variant={prefs.cardPreviewMode === "ctrl" ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setCardPreviewMode("ctrl")}
                >
                  Ctrl + Hover
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Controls when the card preview and ability panel appears. "Hover" shows on mouse
                over, others require holding a modifier key.
              </p>
            </div>

            <div className="rounded-lg border bg-card/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="hover-delay">Card Preview Delay</Label>
                <span className="text-sm font-mono text-muted-foreground">
                  {prefs.cardHoverDelayMs}ms
                </span>
              </div>
              <input
                id="hover-delay"
                type="range"
                min={HOVER_DELAY_MIN}
                max={HOVER_DELAY_MAX}
                step={HOVER_DELAY_STEP}
                value={prefs.cardHoverDelayMs}
                onChange={(e) => prefs.setCardHoverDelayMs(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                How long to hover before the card preview appears. Lower values feel snappier,
                higher values reduce accidental popups.
              </p>
            </div>

            <div className="rounded-lg border bg-card/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="flash-duration">Flash duration</Label>
                <span className="text-sm font-mono text-muted-foreground">{flashDurationMs}ms</span>
              </div>
              <input
                id="flash-duration"
                type="range"
                min={FLASH_MIN}
                max={FLASH_MAX}
                step={FLASH_STEP}
                value={flashDurationMs}
                onChange={(e) => setFlashDurationMs(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                Card-play and turn-start flash duration.
              </p>
            </div>
          </div>
          {/* end preferences grid */}
        </section>
      )}

      {activeTab === "theme" && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Theme</h2>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-card/40 p-4 space-y-2">
              <Label>App Theme</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant={theme === "light" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme("light")}
                >
                  Light
                </Button>
                <Button
                  variant={theme === "dark" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme("dark")}
                >
                  Dark
                </Button>
                <Button
                  variant={theme === "system" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme("system")}
                >
                  System
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Controls app theme preference.</p>
            </div>

            <div className="rounded-lg border bg-card/40 p-4 space-y-2">
              <Label>Color Preset</Label>
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
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg max-h-64 overflow-y-auto">
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
                                Active
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
                Choose a color preset. Works with both light and dark modes.
              </p>
            </div>
          </div>
          {/* end top-level mode/preset grid */}

          <div className="pt-2">
            <Input
              placeholder="Filter colors... (e.g. primary, counter, arrow)"
              value={themeColorFilter}
              onChange={(e) => setThemeColorFilter(e.target.value)}
              className="max-w-sm"
            />
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between gap-2">
              <Label>App Theme Colors</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={prefs.resetAppThemeColorOverrides}
                disabled={Object.keys(prefs.appThemeColorOverrides).length === 0}
              >
                Reset Colors
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
                                title="Click to edit color value"
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
            {/* end app theme grid */}
            <p className="text-xs text-muted-foreground">
              Override individual colors from the active preset.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Game Theme Colors</Label>
              <Button size="sm" variant="outline" onClick={prefs.resetGameThemeColorOverrides}>
                Reset Colors
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
                    description: "Tokens not covered by the groups above.",
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
                                    title="Click to edit color value"
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
            {/* end game theme grid */}
            <p className="text-xs text-muted-foreground">
              Generated from game theme keys. Defaults come from the active preset.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
