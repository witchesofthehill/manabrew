import { useCallback, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionCommanderRef } from "@/stores/useCompanionStore.types";
import { CommanderDeckSelect } from "./CommanderDeckSelect";
import { CommanderSlot } from "./CommanderSlot";

interface CommanderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerId: string;
  initial: [CompanionCommanderRef | null, CompanionCommanderRef | null];
}
interface SlotState {
  query: string;
  pick: CompanionCommanderRef | null;
}
export function CommanderPickerDialog({
  open,
  onOpenChange,
  playerId,
  initial,
}: CommanderPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4 overscroll-contain rounded-lg p-4 sm:p-5">
        <DialogHeader className="text-left">
          <DialogTitle>Choose commander</DialogTitle>
          <DialogDescription className="sr-only">
            Search for a card or choose a deck.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CommanderPickerForm
            playerId={playerId}
            initial={initial}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function CommanderPickerForm({
  playerId,
  initial,
  onClose,
}: {
  playerId: string;
  initial: [CompanionCommanderRef | null, CompanionCommanderRef | null];
  onClose: () => void;
}) {
  const setCommander = useCompanionStore((s) => s.setCommander);
  const renamePlayer = useCompanionStore((s) => s.renamePlayer);
  const oathbreaker = useCompanionStore((s) => s.session?.oathbreaker ?? false);
  const slotLabel = oathbreaker ? "Oathbreaker" : "Commander";
  const partnerLabel = oathbreaker ? "Signature spell" : "Partner or background";
  const [partnerEnabled, setPartnerEnabled] = useState(Boolean(initial[1]));
  const [useCommanderName, setUseCommanderName] = useState(false);
  const [slots, setSlots] = useState<[SlotState, SlotState]>([
    { query: initial[0]?.name ?? "", pick: initial[0] },
    { query: initial[1]?.name ?? "", pick: initial[1] },
  ]);
  const commanderName = (slots[0].pick ?? (partnerEnabled && !oathbreaker ? slots[1].pick : null))
    ?.name;
  const updateSlot = useCallback((index: 0 | 1, patch: Partial<SlotState>) => {
    setSlots((prev) => {
      const next: [SlotState, SlotState] = [prev[0], prev[1]];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);
  const confirm = () => {
    setCommander(playerId, 0, slots[0].pick);
    setCommander(playerId, 1, partnerEnabled ? slots[1].pick : null);
    if (useCommanderName && commanderName) renamePlayer(playerId, commanderName);
    onClose();
  };
  const clearAll = () => {
    setCommander(playerId, 0, null);
    setCommander(playerId, 1, null);
    onClose();
  };
  return (
    <>
      <div className="grid gap-3">
        <CommanderSlot
          slotLabel={slotLabel}
          action={
            <CommanderDeckSelect
              oathbreaker={oathbreaker}
              onChoose={([primary, secondary]) => {
                setSlots([
                  { query: primary.name, pick: primary },
                  { query: secondary?.name ?? "", pick: secondary },
                ]);
                setPartnerEnabled(Boolean(secondary));
              }}
            />
          }
          query={slots[0].query}
          pick={slots[0].pick}
          onQueryChange={(query) => updateSlot(0, { query })}
          onPick={(pick) => updateSlot(0, { pick })}
        />
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit max-w-full justify-start whitespace-normal px-2 text-left text-muted-foreground"
          aria-expanded={partnerEnabled}
          onClick={() => setPartnerEnabled(!partnerEnabled)}
        >
          {partnerEnabled ? <Minus /> : <Plus />}
          {partnerEnabled
            ? oathbreaker
              ? "Remove signature spell slot"
              : "Remove partner slot"
            : oathbreaker
              ? "Add a signature spell"
              : "Add a partner or background"}
        </Button>
        {partnerEnabled && (
          <CommanderSlot
            slotLabel={partnerLabel}
            query={slots[1].query}
            pick={slots[1].pick}
            onQueryChange={(query) => updateSlot(1, { query })}
            onPick={(pick) => updateSlot(1, { pick })}
          />
        )}
        {commanderName && (
          <label className="flex cursor-pointer items-center gap-2 text-ui-label touch:min-h-11">
            <input
              type="checkbox"
              checked={useCommanderName}
              onChange={(e) => setUseCommanderName(e.target.checked)}
              className="size-4 shrink-0 accent-selection"
            />
            Use commander's name as player name
          </label>
        )}
      </div>
      <DialogFooter className="flex-row items-center justify-between border-t pt-3 sm:justify-between">
        <Button variant="ghost" size="sm" onClick={clearAll}>
          Clear commanders
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={confirm}
          disabled={!slots[0].pick && !(partnerEnabled && slots[1].pick)}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
