import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LimitedSetupExtras } from "@/components/limited/LimitedSetupExtras";
import type { RefObject } from "react";
import type { ScryfallSet } from "@/types/scryfall";
import type { LimitedSetupPanel } from "@/components/limited/limitedSetup.types";

interface LimitedSetupDialogProps {
  panel: LimitedSetupPanel | null;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  setup: {
    podSize: number;
    busy: boolean;
    lastError: string | null;
    startChaos: (codes: string[]) => void;
  };
  sets: ScryfallSet[];
  restoreFocus: boolean;
}

export function LimitedSetupDialog({
  panel,
  onClose,
  triggerRef,
  setup,
  sets,
  restoreFocus,
}: LimitedSetupDialogProps) {
  const title = panel === "templates" ? "Sealed templates" : "Themed Chaos Draft";
  return (
    <Dialog
      open={panel !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-3xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (restoreFocus) triggerRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">Additional Limited options.</DialogDescription>
        </DialogHeader>
        {panel && (
          <LimitedSetupExtras
            section={panel}
            sets={sets}
            podSize={setup.podSize}
            busy={setup.busy}
            onStartChaos={(codes) => {
              onClose();
              setup.startChaos(codes);
            }}
          />
        )}
        {setup.lastError && (
          <p role="alert" className="text-sm text-destructive">
            {setup.lastError}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
