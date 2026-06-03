import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import { COMPANION_ACCENT_COLORS } from "@/stores/useCompanionStore.constants";
import type { CompanionPhase } from "@/stores/useCompanionStore.types";

const PHASES: { id: CompanionPhase; short: string; label: string }[] = [
  { id: "untap", short: "UN", label: "Untap" },
  { id: "upkeep", short: "UP", label: "Upkeep" },
  { id: "draw", short: "DR", label: "Draw" },
  { id: "main1", short: "M1", label: "Main 1" },
  { id: "combat", short: "CB", label: "Combat" },
  { id: "main2", short: "M2", label: "Main 2" },
  { id: "end", short: "EN", label: "End" },
];

export function PhaseStrip() {
  const phase = useCompanionStore((s) => s.session?.phase ?? "main1");
  const setPhase = useCompanionStore((s) => s.setPhase);
  const activeAccent = useCompanionStore((s) => {
    const session = s.session;
    if (!session) return null;
    const active = session.players.find((p) => p.id === session.activePlayerId);
    return active ? COMPANION_ACCENT_COLORS[active.accentKey] : null;
  });
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-card/40 px-2 py-1 text-[10px] sm:gap-1 sm:text-xs">
      {PHASES.map((p) => {
        const isActive = phase === p.id;
        return (
          <button
            type="button"
            key={p.id}
            onClick={() => setPhase(p.id)}
            className={cn(
              "flex-1 rounded px-1.5 py-1 font-semibold uppercase tracking-wide transition",
              isActive
                ? activeAccent
                  ? "text-white shadow-sm"
                  : "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            style={isActive && activeAccent ? { backgroundColor: activeAccent } : undefined}
            aria-label={p.label}
            aria-pressed={isActive}
          >
            <span className="sm:hidden">{p.short}</span>
            <span className="hidden sm:inline">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
