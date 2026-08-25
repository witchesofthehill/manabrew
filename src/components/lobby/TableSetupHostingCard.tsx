import { ChevronDown, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { GameIcon } from "@/components/game/GameIcon";
import { EngineMark } from "@/components/lobby/EngineMark";
import { RECONNECT_TIMEOUT_OPTIONS, type RoomKind } from "@/components/lobby/tableSetup.constants";
import { DOCS_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { EngineKind } from "@/types/server";

interface TableSetupHostingCardProps {
  kind: RoomKind;
  engine: EngineKind;
  onEngineChange: (engine: EngineKind) => void;
  canHostForge: boolean;
  isTauri: boolean;
  forgeRoomAvailable: boolean;
  ironsmithEnabled: boolean;
  reconnectTimeoutS: number;
  onReconnectTimeoutSChange: (seconds: number) => void;
}

export function TableSetupHostingCard({
  kind,
  engine,
  onEngineChange,
  canHostForge,
  isTauri,
  forgeRoomAvailable,
  ironsmithEnabled,
  reconnectTimeoutS,
  onReconnectTimeoutSChange,
}: TableSetupHostingCardProps) {
  const warningText =
    kind !== "match"
      ? "Limited runs on the Manabrew engine only — a work in progress that may have bugs or missing cards. Forge nodes host constructed matches, not drafts."
      : engine === "Ironsmith"
        ? "Ironsmith is experimental with partial card support — some decks won't run yet. Tables use Trusted mode: the host browser is authoritative, and hidden information is redacted per player."
        : isTauri && !forgeRoomAvailable
          ? "This build does not include native Forge hosting. Manabrew remains available."
          : "The Manabrew engine is a work in progress and may have bugs or missing cards. For the most stable experience, play on the Forge engine.";

  return (
    <section className="rounded-xl border bg-card/85 p-4 backdrop-blur-md">
      <h2 className="text-sm font-semibold">Hosting</h2>
      <div className="mt-3 space-y-4">
        {kind === "match" ? (
          <details className="group rounded-lg border border-border/70 bg-muted/20">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium [&::-webkit-details-marker]:hidden">
              Engine
              <span className="flex items-center gap-1 font-normal text-muted-foreground">
                <EngineMark engine={engine} className="h-3.5 w-3.5" />
                {engine}
              </span>
              <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-1 border-t border-border/60">
              {canHostForge && (
                <EngineOption
                  selected={engine === "Forge"}
                  onClick={() => onEngineChange("Forge")}
                  mark={
                    <EngineMark
                      engine="Forge"
                      className={cn(
                        "h-3.5 w-3.5",
                        engine === "Forge" ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                  }
                  label="Forge"
                  badge={
                    <Badge variant="outline" className="text-[9px]">
                      {isTauri ? "on this device" : "in this browser"}
                    </Badge>
                  }
                  description={
                    isTauri
                      ? "Full card support, hosted in-app on this device. Others join from the lobby."
                      : "Full card support, hosted in this browser tab. Others join from the lobby."
                  }
                />
              )}
              {!canHostForge && !isTauri && (
                <div className="flex flex-col items-start gap-0.5 rounded-lg bg-muted/40 p-2.5 text-left">
                  <span className="flex items-center gap-1.5">
                    <EngineMark engine="Forge" className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Forge</span>
                    <Badge variant="outline" className="text-[9px]">
                      hosted
                    </Badge>
                  </span>
                  <span className="text-[10px] leading-tight text-muted-foreground">
                    Full card support. Available on{" "}
                    <a
                      href={`${DOCS_URL}/getting-started/`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      Desktop
                    </a>
                    {". "}
                    Or join a Forge table from the list, alternatively,{" "}
                    <a
                      href={`${DOCS_URL}/self-hosting/`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      host your own
                    </a>
                    .
                  </span>
                </div>
              )}
              <EngineOption
                selected={engine === "Manabrew"}
                onClick={() => onEngineChange("Manabrew")}
                mark={
                  <GameIcon
                    name="beer-stein"
                    className={cn(
                      "h-3.5 w-3.5",
                      engine === "Manabrew" ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                }
                label="Manabrew"
                badge={
                  <Badge variant="outline" className="text-[9px]">
                    in-browser
                  </Badge>
                }
                description="Manabrew's own engine, hosted by the table creator."
              />
              {ironsmithEnabled && (
                <EngineOption
                  selected={engine === "Ironsmith"}
                  onClick={() => onEngineChange("Ironsmith")}
                  mark={
                    <EngineMark
                      engine="Ironsmith"
                      className={cn(
                        "h-3.5 w-3.5",
                        engine === "Ironsmith" ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                  }
                  label="Ironsmith"
                  badge={
                    <>
                      <Badge variant="outline" className="text-[9px]">
                        trusted
                      </Badge>
                      <Badge
                        variant="outline"
                        className="border-warning/40 text-[9px] text-warning"
                      >
                        experimental
                      </Badge>
                    </>
                  }
                  description="Ironsmith WASM hosted by the table creator. Partial card support."
                />
              )}
            </div>
          </details>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-xs font-medium">
            Engine
            <span className="flex items-center gap-1 font-normal text-muted-foreground">
              <GameIcon name="beer-stein" className="h-3.5 w-3.5" />
              Manabrew
            </span>
          </div>
        )}
        {!(kind === "match" && engine === "Forge") && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{warningText}</p>
          </div>
        )}
        {kind === "match" && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Reconnect timeout</Label>
            <div className="flex items-center gap-2">
              {RECONNECT_TIMEOUT_OPTIONS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => onReconnectTimeoutSChange(seconds)}
                  className={cn(
                    "flex h-10 flex-1 items-center justify-center rounded-lg border transition-colors",
                    reconnectTimeoutS === seconds
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  )}
                >
                  <span className="text-sm font-medium">{seconds}s</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              How long the game waits for a disconnected player before it is aborted.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function EngineOption({
  selected,
  onClick,
  mark,
  label,
  badge,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  mark: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg p-2.5 text-left transition-colors",
        selected ? "bg-primary/10" : "hover:bg-muted/50",
      )}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        {mark}
        <span className="text-xs font-medium">{label}</span>
        {badge}
      </span>
      <span className="text-[10px] leading-tight text-muted-foreground">{description}</span>
    </button>
  );
}
