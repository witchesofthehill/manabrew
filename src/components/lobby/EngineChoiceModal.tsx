import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Cpu, Cloud, TriangleAlert } from "lucide-react";
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose an engine</DialogTitle>
          <DialogDescription>Which engine should run this game vs AI?</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => onChoose("Manabrew")}
            className="text-left rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Cpu className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Manabrew</span>
              <Badge variant="outline" className="text-[9px]">
                in-browser
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              Manabrew&apos;s own engine, running locally in your browser. Instant, no network — but
              card support is the in-progress Rust port.
            </p>
          </button>
          <button
            onClick={() => onChoose("Forge")}
            disabled={!hostedAvailable}
            className="text-left rounded-lg border p-4 transition-colors enabled:hover:border-primary/40 enabled:hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Cloud className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Forge</span>
              <Badge variant="secondary" className="text-[9px]">
                hosted
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              {hostedAvailable
                ? "Forge on a Manabrew-hosted node — full card support, but adds a little network latency."
                : "Forge on a Manabrew-hosted node — full card support. Not available in this build."}
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
