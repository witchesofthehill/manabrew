import { useEffect, useId, useRef } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LimitedBuildZone } from "@/components/limited/LimitedBuildZone";
import type {
  BuildGroup,
  BuildSession,
  BuildZone,
} from "@/components/limited/useLimitedBuildStore";
import { LimitedAccordionScene } from "@/pixi/limited/LimitedAccordionScene";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";

interface Region {
  id: BuildZone;
  title: string;
  cards: DraftCard[];
  total: number;
}
interface Props {
  zones: readonly Region[];
  mobileZone: BuildZone;
  onZoneChange: (zone: BuildZone) => void;
  compact: boolean;
  visibleZones: readonly BuildZone[];
  expandedZone: BuildZone | null;
  onToggleZone: (zone: BuildZone) => void;
  acquiredIds: readonly string[];
  selectedIds: string[];
  onSelect: (card: DraftCard, additive: boolean) => void;
  onSelectMany: (ids: string[]) => void;
  onMove: (ids: string[], zone: BuildZone) => void;
  onDrop: (card: DraftCard, x: number, y: number) => void;
  group: BuildGroup;
  cardSize: number;
  mode: BuildSession["mode"];
}
export function LimitedBuildBoard({
  zones,
  mobileZone,
  onZoneChange,
  compact,
  visibleZones,
  expandedZone,
  onToggleZone,
  acquiredIds,
  selectedIds,
  onSelect,
  onSelectMany,
  onMove,
  onDrop,
  group,
  cardSize,
  mode,
}: Props) {
  const boardId = useId();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<LimitedAccordionScene | null>(null);
  const open = zones.map((zone) =>
    compact
      ? zone.id === mobileZone
      : visibleZones.includes(zone.id) && (!expandedZone || expandedZone === zone.id),
  );
  useEffect(() => {
    if (compact || !host.current) return;
    const accordion = new LimitedAccordionScene(host.current);
    scene.current = accordion;
    return () => {
      scene.current = null;
      accordion.destroy();
    };
  }, [compact]);
  useEffect(() => {
    scene.current?.update(open);
  });
  return (
    <>
      {compact && (
        <div className="flex shrink-0 flex-wrap gap-1" role="tablist" aria-label="Build zones">
          {zones.map((zone) => (
            <Button
              key={zone.id}
              data-limited-zone={zone.id}
              role="tab"
              aria-selected={mobileZone === zone.id}
              aria-controls={`${boardId}-${zone.id}`}
              variant="ghost"
              size="sm"
              className={cn(
                "data-[limited-drop-active=true]:ring-2 data-[limited-drop-active=true]:ring-card-ring",
                mobileZone !== zone.id && "text-muted-foreground",
              )}
              onClick={() => onZoneChange(zone.id)}
            >
              {zone.title}{" "}
              <span className="text-xs tabular-nums text-muted-foreground">{zone.total}</span>
            </Button>
          ))}
        </div>
      )}
      <div ref={host} className="relative flex min-h-0 flex-1 overflow-hidden">
        {zones.map((zone, index) => {
          const shown = open[index];
          const Icon = shown ? Minimize2 : Maximize2;
          const toggle = () => (shown ? onToggleZone(zone.id) : onZoneChange(zone.id));
          return (
            <div
              key={zone.id}
              data-limited-section={zone.id}
              data-limited-zone={zone.id}
              className={cn(
                "flex min-h-0 shrink-0 flex-col overflow-hidden data-[limited-drop-active=true]:ring-2 data-[limited-drop-active=true]:ring-inset data-[limited-drop-active=true]:ring-card-ring",
                compact && (shown ? "w-full" : "hidden"),
              )}
              style={compact ? undefined : { width: "25%" }}
            >
              {!compact && (
                <header className="flex h-8 shrink-0 items-center gap-1 px-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-w-0 flex-1 justify-start gap-1 px-0 font-serif"
                    aria-expanded={shown}
                    aria-controls={`${boardId}-${zone.id}`}
                    title={zone.title}
                    onClick={toggle}
                    disabled={shown && visibleZones.length === 1}
                  >
                    <span className="truncate">{zone.title}</span>
                    <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground">
                      {zone.total}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 text-muted-foreground"
                    aria-label={`${shown ? "Minify" : "Expand"} ${zone.title}`}
                    title={`${shown ? "Minify" : "Expand"} ${zone.title}`}
                    aria-expanded={shown}
                    aria-controls={`${boardId}-${zone.id}`}
                    disabled={shown && visibleZones.length === 1}
                    onClick={toggle}
                  >
                    <Icon size={12} />
                  </Button>
                </header>
              )}
              <div
                inert={!shown}
                aria-hidden={!shown}
                className="flex min-h-0 flex-1 flex-col"
                style={compact ? undefined : { width: "var(--limited-section-width, 100%)" }}
              >
                <LimitedBuildZone
                  id={`${boardId}-${zone.id}`}
                  visible={shown}
                  title={zone.title}
                  zone={zone.id}
                  cards={zone.cards}
                  acquiredIds={acquiredIds}
                  total={zone.total}
                  selectedIds={selectedIds}
                  onSelect={onSelect}
                  onSelectMany={onSelectMany}
                  onMove={onMove}
                  onDrop={onDrop}
                  group={group}
                  cardSize={cardSize}
                  mode={mode}
                  className="min-h-0 flex-1"
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
