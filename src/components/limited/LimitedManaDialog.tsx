import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import {
  BASIC_LAND_NAMES,
  BASIC_LAND_MANA,
  countManaPips,
  resolveBasicLand,
} from "@/lib/limited.utils";
import { useLimitedBuildStore, type BuildSession } from "@/components/limited/useLimitedBuildStore";
import type { DraftCard } from "@/types/limited";
interface Props {
  sessionKey: string;
  session: BuildSession;
  main: DraftCard[];
  targetMainSize: number;
  onClose: () => void;
}
export function LimitedManaDialog({ sessionKey, session, main, targetMainSize, onClose }: Props) {
  const cache = useScryfallStore((state) => state.cards);
  const initialLands = main.filter((card) => {
    const info = peekCard(cache, card);
    return (
      BASIC_LAND_NAMES.some((name) => name === card.name) ||
      /\bLand\b/.test(info?.card_faces?.[0]?.type_line ?? info?.type_line ?? "")
    );
  }).length;
  const [target, setTarget] = useState(
    Math.max(initialLands, targetMainSize - (main.length - initialLands)),
  );
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const preview = useMemo(() => {
    const ownedIds = new Set(session.allocation.basics.map((card) => card.id));
    const retained = main.filter((card) => !ownedIds.has(card.id));
    const pips = { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 };
    const sources = { ...pips };
    const allocation = { ...pips };
    let lands = 0;
    let unknown = 0;
    for (const card of retained) {
      const info = peekCard(cache, card);
      if (!info) {
        unknown++;
        continue;
      }
      const type = info.card_faces?.[0]?.type_line ?? info.type_line;
      if (/\bLand\b/.test(type)) {
        lands++;
        const produced =
          "produced_mana" in info && Array.isArray(info.produced_mana) ? info.produced_mana : [];
        const text = info.card_faces?.[0]?.oracle_text ?? info.oracle_text ?? "";
        for (const name of BASIC_LAND_NAMES) {
          const letter = BASIC_LAND_MANA[name];
          if (
            produced.includes(letter) ||
            type.includes(name) ||
            /(?:Add|add).*?(?:any color|any one color)/.test(text) ||
            new RegExp(`(?:Add|add)[^\\n]*\\{${letter}\\}`).test(text)
          )
            sources[name]++;
        }
      } else {
        const cost = info.card_faces?.[0]?.mana_cost ?? info.mana_cost ?? "";
        for (const name of BASIC_LAND_NAMES)
          pips[name] += countManaPips(cost, BASIC_LAND_MANA[name]);
      }
    }
    const total = Object.values(pips).reduce((sum, count) => sum + count, 0);
    const missing = Math.max(0, Math.trunc(target) - lands);
    if (total)
      for (let index = 0; index < missing; index++) {
        const name = BASIC_LAND_NAMES.reduce((best, candidate) =>
          pips[candidate] / (sources[candidate] + allocation[candidate] + 1) >
          pips[best] / (sources[best] + allocation[best] + 1)
            ? candidate
            : best,
        );
        allocation[name]++;
      }
    return { allocation, sources, pips, retained, lands, unknown, total, missing };
  }, [cache, main, session.allocation.basics, target]);
  const apply = async () => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    try {
      const printings = await Promise.all(
        BASIC_LAND_NAMES.filter((name) => preview.allocation[name] > 0).map(async (name) => ({
          name,
          card: await resolveBasicLand(name),
        })),
      );
      const basics = printings.flatMap(({ name, card }) =>
        Array.from({ length: preview.allocation[name] }, () => ({
          ...card,
          id: crypto.randomUUID(),
        })),
      );
      useLimitedBuildStore.getState().edit(sessionKey, (current) => ({
        ...current,
        basics,
        mainIds: [...preview.retained.map((card) => card.id), ...basics.map((card) => card.id)],
        sideboardIds: current.sideboardIds.filter(
          (id) => !current.basics.some((card) => card.id === id),
        ),
        maybeIds: current.maybeIds.filter((id) => !current.basics.some((card) => card.id === id)),
      }));
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't resolve the basic land printings.",
      );
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !applying) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Suggest basic lands</DialogTitle>
          <DialogDescription>
            Uses only your main deck's colored costs and included land sources. Acquired lands stay
            in place. This replaces added basics.
          </DialogDescription>
        </DialogHeader>
        <Label htmlFor="limited-land-target">Total land target</Label>
        <Input
          id="limited-land-target"
          type="number"
          min={preview.lands}
          max={targetMainSize}
          value={target}
          onChange={(event) =>
            setTarget(Math.max(0, Math.min(targetMainSize, Number(event.target.value) || 0)))
          }
        />
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>Basic</th>
              <th>Spell pips</th>
              <th>Included sources</th>
              <th>Add</th>
            </tr>
          </thead>
          <tbody>
            {BASIC_LAND_NAMES.map((name) => (
              <tr key={name}>
                <td className="py-2">{name}</td>
                <td>{preview.pips[name]}</td>
                <td>{preview.sources[name]}</td>
                <td>{preview.allocation[name]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          {preview.lands} acquired lands retained. Preview:{" "}
          {preview.retained.length +
            Object.values(preview.allocation).reduce((sum, count) => sum + count, 0)}{" "}
          main cards. A multicolor land counts as a source for each color it produces.
        </p>
        {preview.unknown > 0 && (
          <p role="status" className="text-sm text-warning">
            Waiting for details of {preview.unknown} main cards.
          </p>
        )}
        {!preview.total && (
          <p className="text-sm text-muted-foreground">
            No colored mana costs found. Add the basics you want manually.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void apply()}
            disabled={applying || preview.unknown > 0 || !preview.total || target < preview.lands}
          >
            {applying ? "Applying..." : "Apply preview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
