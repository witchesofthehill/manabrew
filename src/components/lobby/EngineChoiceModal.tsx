import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Cpu, Cloud, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EngineKind } from "@/types/server";

interface EngineChoiceModalProps {
  onChoose: (engine: EngineKind) => void;
  onCancel: () => void;
  hostedAvailable: boolean;
}

export function EngineChoiceModal({ onChoose, onCancel, hostedAvailable }: EngineChoiceModalProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem-var(--safe-area-inset-top)-var(--safe-area-inset-bottom))] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose an engine</DialogTitle>
          <DialogDescription>Which engine should run this game vs AI?</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChoose("Forge")}
            disabled={!hostedAvailable}
            className={cn(
              "min-h-32 rounded-lg border p-4 text-left enabled:hover:border-primary/40 enabled:hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-colors motion-reduce:transition-none pointer-coarse:min-h-40",
              hostedAvailable ? "order-1" : "order-2",
            )}
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Cloud className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Forge</span>
              {hostedAvailable && (
                <Badge variant="secondary" className="text-[9px]">
                  Recommended
                </Badge>
              )}
            </div>
            <p className="text-xs leading-snug text-muted-foreground">
              {hostedAvailable
                ? "The most stable option, running on a Manabrew-hosted Forge node with broad card support. Adds some network latency."
                : "Hosted Forge is unavailable in this build. Choose Manabrew to play locally."}
            </p>
          </button>
          <button
            type="button"
            onClick={() => onChoose("Manabrew")}
            className={cn(
              "min-h-32 rounded-lg border p-4 text-left hover:border-primary/40 hover:bg-muted/30 motion-safe:transition-colors motion-reduce:transition-none pointer-coarse:min-h-40",
              hostedAvailable ? "order-2" : "order-1",
            )}
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Manabrew</span>
              <Badge variant="outline" className="text-[9px]">
                local
              </Badge>
            </div>
            <p className="text-xs leading-snug text-muted-foreground">
              Manabrew&apos;s in-progress Rust engine runs on your device with no hosted-engine
              connection. Some cards and rules are still incomplete.
            </p>
          </button>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {hostedAvailable
              ? "The Manabrew engine is a work in progress and may have bugs or missing cards. For the most stable experience, play on the Forge engine."
              : "The Manabrew engine is a work in progress and may have bugs or missing cards."}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
