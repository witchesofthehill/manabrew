import { ChevronDown, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { EngineMark } from "@/components/lobby/EngineMark";
import { RECONNECT_TIMEOUT_OPTIONS } from "@/components/lobby/tableSetup.constants";
import { cn } from "@/lib/utils";
interface TableSetupHostingCardProps {
  engine: "Forge" | "Ironsmith";
  onEngineChange: (engine: "Forge" | "Ironsmith") => void;
  isTauri: boolean;
  hostedNode: boolean;
  ironsmithEnabled: boolean;
  reconnectTimeoutS: number;
  onReconnectTimeoutSChange: (seconds: number) => void;
}
export function TableSetupHostingCard({
  engine,
  onEngineChange,
  isTauri,
  hostedNode,
  ironsmithEnabled,
  reconnectTimeoutS,
  onReconnectTimeoutSChange,
}: TableSetupHostingCardProps) {
  const forgeLocation = hostedNode ? "on a node" : isTauri ? "on this device" : "in this browser";
  return (
    <section className="rounded-xl border bg-card/85 p-4 backdrop-blur-md">
      <h2 className="text-ui-label font-semibold">Hosting</h2>
      <div className="mt-3 space-y-4">
        {ironsmithEnabled ? (
          <details className="group rounded-lg border border-border/70 bg-muted/20">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-ui-label font-medium [&::-webkit-details-marker]:hidden touch:min-h-11 touch:min-w-11">
              Engine
              <span className="flex items-center gap-1 font-normal text-muted-foreground">
                <EngineMark engine={engine} className="h-3.5 w-3.5" />
                {engine}
              </span>
              <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-1 border-t border-border/60">
              <EngineOption
                selected={engine === "Forge"}
                onClick={() => onEngineChange("Forge")}
                mark={<EngineMark engine="Forge" className="h-3.5 w-3.5" />}
                label="Forge"
                badge={
                  <Badge variant="outline" className="text-ui-meta">
                    {forgeLocation}
                  </Badge>
                }
                description="Full card support. Other players join from the lobby."
              />
              <EngineOption
                selected={engine === "Ironsmith"}
                onClick={() => onEngineChange("Ironsmith")}
                mark={<EngineMark engine="Ironsmith" className="h-3.5 w-3.5" />}
                label="Ironsmith"
                badge={
                  <>
                    <Badge variant="outline" className="text-ui-meta">
                      trusted
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-warning/40 text-ui-meta text-warning"
                    >
                      experimental
                    </Badge>
                  </>
                }
                description="Ironsmith WASM hosted by the table creator. Partial card support."
              />
            </div>
          </details>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-ui-label">
            <EngineMark engine="Forge" className="h-3.5 w-3.5" />
            <span className="font-medium">Forge</span>
            <span className="text-muted-foreground">{forgeLocation}</span>
          </div>
        )}
        {engine === "Ironsmith" && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-ui-meta text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Ironsmith has partial card support, so some decks may not run. The host browser runs
              the game and sends each player only the information they can see.
            </p>
          </div>
        )}
        {!(engine === "Forge" && hostedNode) && (
          <div className="space-y-1.5">
            <Label className="text-ui-label font-medium">Reconnect timeout</Label>
            <div className="flex items-center gap-2">
              {RECONNECT_TIMEOUT_OPTIONS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => onReconnectTimeoutSChange(seconds)}
                  className={cn(
                    "flex min-h-10 flex-1 items-center justify-center rounded-lg border transition-colors touch:min-h-11 touch:min-w-11 text-ui-label whitespace-normal",
                    reconnectTimeoutS === seconds
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  )}
                >
                  <span className="text-ui-label font-medium">{seconds}s</span>
                </button>
              ))}
            </div>
            <p className="text-ui-meta text-muted-foreground">
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
        "flex flex-col items-start gap-0.5 rounded-lg p-2.5 text-left transition-colors touch:min-h-11 touch:min-w-11 text-ui-label whitespace-normal",
        selected ? "bg-selection/15" : "hover:bg-muted/50",
      )}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        {mark}
        <span className="text-ui-label font-medium">{label}</span>
        {badge}
      </span>
      <span className="text-ui-body leading-tight text-muted-foreground">{description}</span>
    </button>
  );
}
