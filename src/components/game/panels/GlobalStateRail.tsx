import { Compass, Crown, Map, Moon, Orbit, Sun, Users, type LucideIcon } from "lucide-react";

import type { DayTime, DungeonStateDto } from "@/protocol/game";
import { useGameDevStore } from "@/stores/useGameDevStore";

interface GlobalStateRailProps {
  dayTime: DayTime;
  monarchName?: string;
  initiativeName?: string;
  selfName: string;
  dungeonState?: DungeonStateDto;
  activePlaneNames?: string[];
  activeSchemeNames?: string[];
  teamNumber?: number;
  dividerY?: number;
}

interface RailItem {
  id: string;
  label: string;
  value: string;
  icon: LucideIcon;
  emphasis?: "primary" | "warning";
}

export function GlobalStateRail({
  dayTime,
  monarchName,
  initiativeName,
  selfName,
  dungeonState,
  activePlaneNames,
  activeSchemeNames,
  teamNumber,
  dividerY,
}: GlobalStateRailProps) {
  const gameStateOverrides = useGameDevStore((state) => state.gameStateOverrides);
  const playerOverrides = useGameDevStore((state) => state.playerOverrides);
  const effectiveDayTime =
    gameStateOverrides.dayNight === "none" ? dayTime : gameStateOverrides.dayNight;
  const items: RailItem[] = [];

  if (effectiveDayTime === "day") {
    items.push({ id: "day", label: "Day", value: "Daybound", icon: Sun, emphasis: "warning" });
  } else if (effectiveDayTime === "night") {
    items.push({
      id: "night",
      label: "Night",
      value: "Nightbound",
      icon: Moon,
      emphasis: "primary",
    });
  }

  const effectiveMonarch = playerOverrides.forceMonarch ? selfName : monarchName;
  if (effectiveMonarch) {
    items.push({
      id: "monarch",
      label: "Monarch",
      value: effectiveMonarch,
      icon: Crown,
      emphasis: "warning",
    });
  }

  const effectiveInitiative = playerOverrides.forceInitiative ? selfName : initiativeName;
  if (effectiveInitiative) {
    items.push({
      id: "initiative",
      label: "Initiative",
      value: effectiveInitiative,
      icon: Compass,
      emphasis: "primary",
    });
  }

  const dungeonValue = dungeonState
    ? [dungeonState.name, dungeonState.room].filter(Boolean).join(" · ")
    : gameStateOverrides.forceDungeon
      ? "Dark Pool"
      : undefined;
  if (dungeonValue) {
    items.push({ id: "dungeon", label: "Dungeon", value: dungeonValue, icon: Map });
  }

  const planeValue =
    activePlaneNames && activePlaneNames.length > 0
      ? `${activePlaneNames[0]}${activePlaneNames.length > 1 ? ` +${activePlaneNames.length - 1}` : ""}`
      : gameStateOverrides.forcePlane
        ? "Naya"
        : undefined;
  if (planeValue) {
    items.push({ id: "plane", label: "Plane", value: planeValue, icon: Orbit });
  }

  const schemeValue =
    activeSchemeNames && activeSchemeNames.length > 0
      ? `${activeSchemeNames[0]}${activeSchemeNames.length > 1 ? ` +${activeSchemeNames.length - 1}` : ""}`
      : gameStateOverrides.forceScheme
        ? "Ongoing"
        : undefined;
  if (schemeValue) {
    items.push({ id: "scheme", label: "Scheme", value: schemeValue, icon: Crown });
  }

  const effectiveTeamNumber = teamNumber ?? (gameStateOverrides.forceTeam ? 1 : undefined);
  if (effectiveTeamNumber != null) {
    items.push({
      id: "team",
      label: "Team",
      value: `Team ${effectiveTeamNumber}`,
      icon: Users,
    });
  }

  if (items.length === 0) return null;

  const leftItems = items.filter((_, index) => index % 2 === 1);
  const rightItems = items.filter((_, index) => index % 2 === 0);
  const renderItems = (railItems: RailItem[]) =>
    railItems.map(({ id, label, value, icon: Icon, emphasis }) => (
      <div
        key={id}
        className="flex items-center gap-1.5 rounded-full border border-border/70 bg-card/95 px-2.5 py-1 font-game text-[11px] shadow-md backdrop-blur-sm"
      >
        <Icon
          className={
            emphasis === "warning"
              ? "h-3.5 w-3.5 text-warning"
              : emphasis === "primary"
                ? "h-3.5 w-3.5 text-primary"
                : "h-3.5 w-3.5 text-muted-foreground"
          }
        />
        <span className="font-bold uppercase tracking-wide text-foreground">{label}</span>
        <span className="text-muted-foreground">{value}</span>
      </div>
    ));

  return (
    <aside
      aria-label="Global game state"
      className="pointer-events-none absolute inset-x-2 top-[calc(0.5rem+var(--safe-area-inset-top))] z-30 grid grid-cols-[minmax(0,1fr)_clamp(22rem,46vw,42rem)_minmax(0,1fr)] items-center gap-2"
      style={
        dividerY == null
          ? undefined
          : { top: Math.max(24, dividerY), transform: "translateY(-50%)" }
      }
    >
      <div className="flex flex-wrap justify-end gap-1.5">{renderItems(leftItems)}</div>
      <div aria-hidden="true" />
      <div className="flex flex-wrap justify-start gap-1.5">{renderItems(rightItems)}</div>
    </aside>
  );
}
