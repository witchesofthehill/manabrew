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
import { toPickerHexColor, parseThemeColor, formatThemeColor } from "@/themes/gameTheme";
import type { GameThemeColorKey } from "@/themes/gameTheme";
import {
  APP_THEME_COLOR_DESCRIPTIONS,
  APP_THEME_COLOR_LABELS,
  APP_THEME_GROUPS,
  GAME_THEME_COLOR_DESCRIPTIONS,
  GAME_THEME_GROUPS,
} from "@/themes/themeMetadata";
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
    const parsed = parseThemeColor(next);
    if (!parsed) {
      toast.error("Use a valid hex or rgb/rgba color.");
      return;
    }
    const color = formatThemeColor(parsed.hex, parsed.alpha);
    if (path.startsWith("app.")) {
      prefs.setAppThemeColorOverride(
        resolvedTheme === "light" ? "light" : "dark",
        path.slice(4) as keyof ThemeColors,
        color,
      );
    } else {
      prefs.setGameThemeColorOverride(path, color);
    }
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
      toast.error("That name is reserved for a built-in server");
      return;
    }
    prefs.addSavedServer({ name, host, port: Number(port), password });
    setNewServerName("");
    setSavingServer(false);
    toast.success(`Saved "${name}"`);
  }

  async function handleClearImageCache() {
    setClearingCache(true);
    try {
      useScryfallStore.getState().clearImageCaches();
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      toast.success("Image cache cleared — reloading…");
      window.location.reload();
    } catch {
      setClearingCache(false);
      toast.error("Couldn't clear the image cache");
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
              Account
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
              My assets
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
            Preferences
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
            Theme
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
            Prompts
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
            Shortcuts
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
            Server
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
            Cache
          </button>
        </div>
      </section>

      {activeTab === "account" && isFeatureEnabled("accounts") && <AccountSection />}

      {activeTab === "assets" && <MyAssetsSection />}

      {activeTab === "keybindings" && <KeybindingsPanel />}

      {activeTab === "cache" && <CardArtDownloadSection />}

      {activeTab === "cache" && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Cache</h2>
          <div className="rounded-lg border bg-card/40 p-4 space-y-3 max-w-xl">
            <Label>Card Image Cache</Label>
            <p className="text-xs text-muted-foreground">
              Drops Manabrew&apos;s in-memory card textures and image object URLs, clears the
              CacheStorage API, then reloads so every card image is fetched fresh. Use this if
              battlefield card art fails to appear. For a full browser HTTP cache wipe, use the
              browser&apos;s &quot;Empty Cache and Hard Reload&quot; (DevTools open → right-click
              reload).
            </p>
            <Button
              variant="destructive"
              onClick={() => void handleClearImageCache()}
              disabled={clearingCache}
            >
              {clearingCache ? "Clearing…" : "Clear image cache & reload"}
            </Button>
          </div>
        </section>
      )}

      {activeTab === "prompts" && <PromptPreferencesPanel />}

      {activeTab === "server" && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Server</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={!hasChanges && !server.error}>
              Save & Reconnect
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Server className="h-4 w-4" />
                  Saved servers
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56">
                <DropdownMenuLabel>Built-in</DropdownMenuLabel>
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
                    <DropdownMenuLabel>Your servers</DropdownMenuLabel>
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
              Save current server…
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
                placeholder="Name this server"
                className="max-w-xs"
              />
              <Button size="sm" onClick={saveCurrentServer} disabled={!newServerName.trim()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSavingServer(false)}>
                Cancel
              </Button>
              <span className="text-xs text-muted-foreground">
                Saves the current host, port, and password so you can switch back later.
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Server connection settings. Saving will disconnect and reconnect with the new
            credentials.
          </p>
        </section>
      )}

      {activeTab === "preferences" && (
        <section>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <PreferenceCard
              title="Default Playmat"
              description="Used in games when the deck you're playing has no custom playmat of its own."
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
                      alt="Your default playmat"
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
                    title="Remove playmat"
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
              title="Battlefield Zone Column Order"
              description="Controls placement of Library / Graveyard / Exile in the in-field zone column."
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
                      <option value="library">Library</option>
                      <option value="graveyard">Graveyard</option>
                      <option value="exile">Exile</option>
                    </select>
                  </div>
                ))}
              </div>
            </PreferenceCard>

            <PreferenceCard
              title="Card Size"
              value={`${Math.round(prefs.cardSizeMultiplier * 100)}%`}
              description="Scales cards on every battlefield and your hand fan. 100% is the classic 3-row board; battlefield cards cap at a 2-row fill so the board stays playable, while the hand keeps growing past them."
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
              title="Hand Ordering"
              description="Drag cards sideways for a custom order, or keep every hand sorted automatically by color or mana value."
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
              title="Battlefield Layout"
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
                  Free placement
                </Button>
                <Button
                  variant={prefs.battlefieldAutoSort ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setBattlefieldAutoSort(true)}
                >
                  Auto-arrange
                </Button>
              </div>
            </PreferenceCard>

            <PreferenceCard
              title="Zone Piles"
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
                  Movable
                </Button>
                <Button
                  variant={prefs.lockZoneTiles ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setLockZoneTiles(true)}
                >
                  Locked
                </Button>
              </div>
            </PreferenceCard>

            <PreferenceCard
              title="Battlefield Card Style"
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
                    Realistic
                  </Button>
                  <Button
                    variant={prefs.battlefieldCardStyle === "art" ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setBattlefieldCardStyle("art")}
                  >
                    Art-forward
                  </Button>
                  <Button
                    variant={prefs.battlefieldCardStyle === "frame" ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setBattlefieldCardStyle("frame")}
                  >
                    Mini-frame
                  </Button>
                </div>
                <BattlefieldStylePreview style={prefs.battlefieldCardStyle} />
              </div>
            </PreferenceCard>

            <PreferenceCard
              title="In-game Animations"
              description="Decorative board effects — creature entrance stomp + dust, stat and damage pops, glow pulses. Turn these off to save performance on weaker hardware; the board still works (cards move, state indicators and damage numbers stay)."
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={prefs.inGameAnimations ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setInGameAnimations(true)}
                >
                  On
                </Button>
                <Button
                  variant={!prefs.inGameAnimations ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setInGameAnimations(false)}
                >
                  Off
                </Button>
              </div>
            </PreferenceCard>

            {isFeatureEnabled("ironsmithRuntime") && IRONSMITH_WASM_AVAILABLE && (
              <PreferenceCard
                title="Ironsmith engine (experimental)"
                description="Adds the experimental Ironsmith trusted engine as a Create Room option. Card support is partial and games may be rough — off by default. Leave this off unless you're testing Ironsmith."
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={prefs.ironsmithRuntimeEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setIronsmithRuntimeEnabled(true)}
                  >
                    On
                  </Button>
                  <Button
                    variant={!prefs.ironsmithRuntimeEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => prefs.setIronsmithRuntimeEnabled(false)}
                  >
                    Off
                  </Button>
                </div>
              </PreferenceCard>
            )}

            <PreferenceCard
              title="Opponent layout"
              description="Focus on one opponent, or keep every opponent field equally visible."
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={prefs.opponentLayout === "focused" ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setOpponentLayout("focused")}
                >
                  Focused
                </Button>
                <Button
                  variant={prefs.opponentLayout === "overview" ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setOpponentLayout("overview")}
                >
                  Overview
                </Button>
              </div>
            </PreferenceCard>

            <PreferenceCard
              title="Peer to Peer"
              description="Skip manabrew servers and connect directly to the other players at the table. This shares your IP address with the people you play with, and only activates if every player in the game has it enabled."
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={prefs.directTransport ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setDirectTransport(true)}
                >
                  On
                </Button>
                <Button
                  variant={!prefs.directTransport ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setDirectTransport(false)}
                >
                  Off
                </Button>
              </div>
            </PreferenceCard>

            <PreferenceCard
              title="Hand Card Style"
              description="Printed card shows the card image. Dynamic view uses the card's current rules and game state; each card can still be switched."
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
              title="Default Stack Card View"
              description="Choose which face stack cards show when they appear. You can still switch individual cards."
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
              title="Card Preview Style"
              description="Printed card shows the full card image. Dynamic view prioritizes current rules, actions, costs, counters, and other game state."
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
              title="Flash duration"
              value={`${flashDurationMs}ms`}
              description="Card-play and turn-start flash duration."
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
              title="Default Playmat"
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
                onClick={() =>
                  prefs.resetAppThemeColorOverrides(resolvedTheme === "light" ? "light" : "dark")
                }
                disabled={
                  Object.keys(
                    prefs.appThemeColorOverrides[resolvedTheme === "light" ? "light" : "dark"],
                  ).length === 0
                }
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
                        const activeValue = prefs.appThemeColorOverrides[mode][key] ?? presetValue;
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
                                aria-label={APP_THEME_COLOR_LABELS[key]}
                                value={toPickerHexColor(activeValue)}
                                onChange={(e) =>
                                  prefs.setAppThemeColorOverride(
                                    mode,
                                    key,
                                    formatThemeColor(
                                      e.target.value,
                                      parseThemeColor(activeValue)!.alpha,
                                    ),
                                  )
                                }
                                className="h-8 w-10 shrink-0 rounded border border-input bg-transparent p-0.5"
                              />
                              {editingThemeColorPath === `app.${key}` ? (
                                <input
                                  autoFocus
                                  aria-label={`${APP_THEME_COLOR_LABELS[key]} value`}
                                  value={editingThemeColorValue}
                                  onChange={(e) => setEditingThemeColorValue(e.target.value)}
                                  onBlur={() => commitThemeColorEdit(`app.${key}`, presetValue)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      commitThemeColorEdit(`app.${key}`, presetValue);
                                    if (e.key === "Escape") {
                                      setEditingThemeColorPath(null);
                                      setEditingThemeColorValue("");
                                    }
                                  }}
                                  className="flex-1 min-w-0 h-7 rounded border border-input bg-background px-1.5 text-right text-[11px] font-mono"
                                  spellCheck={false}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="flex-1 min-w-0 text-right text-[11px] font-mono text-muted-foreground hover:text-foreground underline-offset-2 hover:underline truncate"
                                  onClick={() => beginThemeColorEdit(`app.${key}`, activeValue)}
                                  title="Click to edit color value"
                                >
                                  {activeValue}
                                </button>
                              )}
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
                                  description={
                                    GAME_THEME_COLOR_DESCRIPTIONS[path as GameThemeColorKey]
                                  }
                                />
                              </Label>
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  id={`theme-color-${path}`}
                                  type="color"
                                  value={toPickerHexColor(activeColor)}
                                  onChange={(e) =>
                                    prefs.setGameThemeColorOverride(
                                      path,
                                      formatThemeColor(
                                        e.target.value,
                                        parseThemeColor(activeColor)!.alpha,
                                      ),
                                    )
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
            <p className="text-xs text-muted-foreground">
              Generated from game theme keys. Defaults come from the active preset.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
