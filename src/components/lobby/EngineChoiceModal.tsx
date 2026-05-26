import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Cpu, Cloud } from "lucide-react";
import type { EngineKind } from "@/types/server";

interface EngineChoiceModalProps {
  onChoose: (engine: EngineKind) => void;
  onCancel: () => void;
}

/** Asked at the start of a Play-vs-AI game (web, when a hosted node is available):
 *  which engine runs it — the in-browser Rust/WASM engine or hosted Java Forge. */
export function EngineChoiceModal({ onChoose, onCancel }: EngineChoiceModalProps) {
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
            onClick={() => onChoose("Wasm")}
            className="text-left rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Cpu className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Rust</span>
              <Badge variant="outline" className="text-[9px]">
                in-browser
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              ManaBrew&apos;s own engine, running locally in your browser. Instant, no network — but
              card support is the in-progress Rust port.
            </p>
          </button>
          <button
            onClick={() => onChoose("Java")}
            className="text-left rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Cloud className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Forge</span>
              <Badge variant="secondary" className="text-[9px]">
                hosted
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              Java Forge on a ManaBrew-hosted node — full card support, but adds a little network
              latency.
            </p>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
