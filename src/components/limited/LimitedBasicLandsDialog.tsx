import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import {
  BASIC_LAND_NAMES,
  BASIC_LAND_MANA,
  resolveBasicLand,
  type BasicLandName,
} from "@/lib/limited.utils";

interface Props {
  sessionKey: string;
  onClose: () => void;
}

export function LimitedBasicLandsDialog({ sessionKey, onClose }: Props) {
  const [counts, setCounts] = useState<Record<BasicLandName, number>>({
    Plains: 0,
    Island: 0,
    Swamp: 0,
    Mountain: 0,
    Forest: 0,
  });
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const total = BASIC_LAND_NAMES.reduce((sum, name) => sum + counts[name], 0);
  const add = async () => {
    if (addingRef.current || !total) return;
    addingRef.current = true;
    setAdding(true);
    try {
      const printings = await Promise.all(
        BASIC_LAND_NAMES.filter((name) => counts[name] > 0).map(async (name) => ({
          name,
          card: await resolveBasicLand(name),
        })),
      );
      const basics = printings.flatMap(({ name, card }) =>
        Array.from({ length: counts[name] }, () => ({ ...card, id: crypto.randomUUID() })),
      );
      useLimitedBuildStore.getState().edit(sessionKey, (allocation) => ({
        ...allocation,
        basics: [...allocation.basics, ...basics],
        mainIds: [...allocation.mainIds, ...basics.map((card) => card.id)],
      }));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the basic lands.");
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !adding) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Add basic lands</DialogTitle>
            <DialogDescription>
              Choose how many of each basic land to add to your mainboard. Existing cards stay in
              place.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={adding} className="space-y-2">
            {BASIC_LAND_NAMES.map((name) => (
              <div key={name} className="flex items-center justify-between gap-4">
                <Label htmlFor={`limited-basic-${name}`} className="flex items-center gap-2">
                  <ManaSymbols cost={BASIC_LAND_MANA[name]} size="lg" className="mx-0" />
                  {name}
                </Label>
                <Input
                  id={`limited-basic-${name}`}
                  type="number"
                  min={0}
                  step={1}
                  value={counts[name]}
                  className="w-24 text-right tabular-nums"
                  onChange={(event) =>
                    setCounts((current) => ({
                      ...current,
                      [name]: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                    }))
                  }
                />
              </div>
            ))}
          </fieldset>
          <p className="text-sm tabular-nums text-muted-foreground">
            {total} basic land{total !== 1 ? "s" : ""} to add
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={adding} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={adding || !total}>
              {adding ? "Adding…" : "Add basic lands"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
