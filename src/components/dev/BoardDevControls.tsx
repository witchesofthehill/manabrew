import { Eye, Grid3X3, MousePointer2, PanelTop, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useStackUIStore } from "@/stores/useStackUIStore";

import { DEV_SECTION, DEV_SECTION_HEADING } from "./devPanel.styles";

export function BoardDevControls() {
  const stats = useGameDevStore((s) => s.pixiPerfStats);
  const devToolsEnabled = useGameDevStore((s) => s.devToolsEnabled);
  const showHoverAreas = useGameDevStore((s) => s.showHoverAreas);
  const showPlayerPanelBounds = useGameDevStore((s) => s.showPlayerPanelBounds);
  const showGridSkeleton = useGameDevStore((s) => s.showGridSkeleton);
  const showAttackRows = useGameDevStore((s) => s.showAttackRows);
  const setDevToolsEnabled = useGameDevStore((s) => s.setDevToolsEnabled);
  const setShowHoverAreas = useGameDevStore((s) => s.setShowHoverAreas);
  const setShowPlayerPanelBounds = useGameDevStore((s) => s.setShowPlayerPanelBounds);
  const setShowGridSkeleton = useGameDevStore((s) => s.setShowGridSkeleton);
  const setShowAttackRows = useGameDevStore((s) => s.setShowAttackRows);
  const triggerEtbGlow = useGameDevStore((s) => s.triggerEtbGlow);
  const gameStateOverrides = useGameDevStore((s) => s.gameStateOverrides);
  const setGameStateOverride = useGameDevStore((s) => s.setGameStateOverride);
  const setStackCollapsed = useStackUIStore((s) => s.setCollapsed);

  const fps = stats?.fps.toFixed(1) ?? "—";
  const frameMs = stats?.deltaMs.toFixed(1) ?? "—";
  const range = stats ? `${stats.minFps.toFixed(0)}–${stats.maxFps.toFixed(0)}` : "—";
  const fpsColor =
    stats == null
      ? "text-muted-foreground"
      : stats.fps >= 55
        ? "text-success"
        : stats.fps >= 40
          ? "text-warning"
          : "text-destructive";

  return (
    <>
      <section className={DEV_SECTION}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className={DEV_SECTION_HEADING}>Renderer</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Live Pixi performance for the current battlefield.
            </p>
          </div>
          <div className="text-right">
            <p className={cn("font-mono text-2xl font-semibold tabular-nums", fpsColor)}>{fps}</p>
            <p className="font-mono text-[10px] text-muted-foreground">FPS</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric label="Frame" value={`${frameMs} ms`} />
          <Metric label="Observed range" value={range} />
        </div>
      </section>

      <section className={DEV_SECTION}>
        <p className={DEV_SECTION_HEADING}>Board guides</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <GuideToggle
            icon={MousePointer2}
            label="Hover targets"
            description="Hand, battlefield, and preview hit areas"
            checked={showHoverAreas}
            onChange={setShowHoverAreas}
          />
          <GuideToggle
            icon={PanelTop}
            label="Player panel bounds"
            description="Full layout box for every player HUD"
            checked={showPlayerPanelBounds}
            onChange={setShowPlayerPanelBounds}
          />
          <GuideToggle
            icon={Grid3X3}
            label="Layout skeleton"
            description="Rows and card slots for every player"
            checked={showGridSkeleton}
            onChange={setShowGridSkeleton}
          />
          <GuideToggle
            icon={Eye}
            label="Attack rows"
            description="Combat drop areas for every player"
            checked={showAttackRows}
            onChange={setShowAttackRows}
          />
        </div>
      </section>

      <section className={DEV_SECTION}>
        <p className={DEV_SECTION_HEADING}>Game-state surfaces</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <GuideToggle
            label="Stack activity"
            description="Collapsed stack count and attention state"
            checked={gameStateOverrides.forceStackActivity}
            onChange={(checked) => {
              setGameStateOverride("forceStackActivity", checked);
              if (checked) setStackCollapsed(true);
            }}
          />
          <GuideToggle
            label="Log activity"
            description="Unread action-log indicator"
            checked={gameStateOverrides.forceLogActivity}
            onChange={(checked) => setGameStateOverride("forceLogActivity", checked)}
          />
          <GuideToggle
            label="Combat summary"
            description="Active combat totals and danger state"
            checked={gameStateOverrides.forceCombatSummary}
            onChange={(checked) => setGameStateOverride("forceCombatSummary", checked)}
          />
        </div>
      </section>

      <section className={DEV_SECTION}>
        <p className={DEV_SECTION_HEADING}>Global mechanics</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["none", "day", "night"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={gameStateOverrides.dayNight === value ? "default" : "outline"}
              onClick={() => setGameStateOverride("dayNight", value)}
            >
              {value === "none" ? "Live" : value}
            </Button>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <GuideToggle
            label="Dungeon"
            description="Current dungeon room"
            checked={gameStateOverrides.forceDungeon}
            onChange={(checked) => setGameStateOverride("forceDungeon", checked)}
          />
          <GuideToggle
            label="Plane"
            description="Current plane and planar die"
            checked={gameStateOverrides.forcePlane}
            onChange={(checked) => setGameStateOverride("forcePlane", checked)}
          />
          <GuideToggle
            label="Scheme"
            description="Active scheme"
            checked={gameStateOverrides.forceScheme}
            onChange={(checked) => setGameStateOverride("forceScheme", checked)}
          />
          <GuideToggle
            label="Team"
            description="Shared-team designation"
            checked={gameStateOverrides.forceTeam}
            onChange={(checked) => setGameStateOverride("forceTeam", checked)}
          />
        </div>
      </section>

      <section className={DEV_SECTION}>
        <p className={DEV_SECTION_HEADING}>Tools</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            className="justify-start"
            onClick={triggerEtbGlow}
          >
            <Sparkles />
            Replay ETB glow
          </Button>
          <GuideToggle
            label="Zustand DevTools"
            description="Mount the state inspector"
            checked={devToolsEnabled}
            onChange={setDevToolsEnabled}
          />
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function GuideToggle({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon?: typeof Eye;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        "flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        checked
          ? "border-primary bg-primary/10"
          : "border-border/70 bg-background/40 hover:bg-accent/40",
      )}
      onClick={() => onChange(!checked)}
    >
      {Icon ? <Icon className={cn("h-4 w-4 shrink-0", checked && "text-primary")} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked ? "border-primary bg-primary" : "border-border bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 block h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform",
            checked ? "translate-x-[1.05rem]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
