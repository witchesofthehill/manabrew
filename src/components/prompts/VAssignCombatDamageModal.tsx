import { Button } from "@/components/ui/button";
import { Modal } from "@/components/game/modals/Modal";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { useGameStore } from "@/stores/useGameStore";
import type { PromptProps } from "./internal/promptProps";
import type {
  ChooseCombatDamageAssignmentInput,
  ChooseCombatDamageAssignmentOutput,
} from "@/protocol";

function parseCombatNumber(value?: string | null): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function VAssignCombatDamageModal({
  input,
  respond,
}: PromptProps<ChooseCombatDamageAssignmentInput, ChooseCombatDamageAssignmentOutput>) {
  const { attackerId, blockerIds, defenderId, totalDamage, attackerHasDeathtouch } = input;
  const gameView = useGameStore((s) => s.gameView)!;
  const [assigned, setAssigned] = useState<Record<string, number>>({});

  const attacker = gameView.battlefield.find((c) => c.id === attackerId);

  const assignees = useMemo(() => {
    const ordered = [...blockerIds];
    if (defenderId) ordered.push(defenderId);
    return ordered;
  }, [blockerIds, defenderId]);

  const remaining = assignees.reduce((acc, id) => acc - (assigned[id] ?? 0), totalDamage);

  const defendingPlayer = defenderId
    ? gameView.players.find((p) => p.id === defenderId)
    : undefined;
  const defenderDamage = defenderId ? (assigned[defenderId] ?? 0) : 0;

  function normalizeAssignments(input: Record<string, number>): Record<string, number> {
    const next: Record<string, number> = {};
    let foundNotLethalEarlier = false;

    for (const id of assignees) {
      const amount = Math.max(0, input[id] ?? 0);
      if (id !== defenderId) {
        if (foundNotLethalEarlier) {
          next[id] = 0;
          continue;
        }
        next[id] = amount;
        if (amount < getLethal(id)) {
          foundNotLethalEarlier = true;
        }
      } else {
        next[id] = foundNotLethalEarlier ? 0 : amount;
      }
    }
    return next;
  }

  function isLegallyOrderedState(state: Record<string, number>): boolean {
    let foundNotLethalEarlier = false;
    for (const id of assignees) {
      const amount = Math.max(0, state[id] ?? 0);
      if (id !== defenderId) {
        if (foundNotLethalEarlier && amount > 0) return false;
        if (amount < getLethal(id)) foundNotLethalEarlier = true;
      } else if (foundNotLethalEarlier && amount > 0) {
        return false;
      }
    }
    return true;
  }

  function getLabel(id: string): string {
    const card = gameView.battlefield.find((c) => c.id === id);
    if (card) return card.name;
    const player = gameView.players.find((p) => p.id === id);
    if (player) return player.name;
    return id;
  }

  function getLethal(id: string): number {
    if (id === defenderId) return Number.MAX_SAFE_INTEGER;
    const card = gameView.battlefield.find((c) => c.id === id);
    if (!card) return 0;
    if (card.types?.includes("Planeswalker")) {
      const loyalty = card.counters?.LOYALTY ?? card.counters?.Loyalty ?? 0;
      return Math.max(0, loyalty);
    }
    if (attackerHasDeathtouch) return 1;
    const toughness = parseCombatNumber(card.toughness);
    const markedDamage = card.damage ?? 0;
    return Math.max(0, toughness - markedDamage);
  }

  function canAssignToIndex(index: number): boolean {
    for (let i = 0; i < index; i += 1) {
      const prevId = assignees[i];
      if (prevId === defenderId) continue;
      if ((assigned[prevId] ?? 0) < getLethal(prevId)) return false;
    }
    return true;
  }

  function addDamage(id: string, index: number, delta: number) {
    if (delta > 0 && !canAssignToIndex(index)) return;
    if (delta > 0 && remaining <= 0) return;

    setAssigned((prev) => {
      const next = { ...prev };
      const current = next[id] ?? 0;
      const cappedDelta = delta > 0 ? Math.min(delta, remaining) : delta;
      next[id] = Math.max(0, current + cappedDelta);
      return normalizeAssignments(next);
    });
  }

  function autoAssign() {
    const next: Record<string, number> = {};
    let dmgLeft = totalDamage;

    for (const id of assignees) {
      if (dmgLeft <= 0) break;
      if (id === defenderId) continue;
      const lethal = getLethal(id);
      const dmg = Math.min(lethal, dmgLeft);
      next[id] = dmg;
      dmgLeft -= dmg;
    }

    if (dmgLeft > 0) {
      if (defenderId) {
        next[defenderId] = (next[defenderId] ?? 0) + dmgLeft;
      } else if (assignees.length > 0) {
        const last = assignees[assignees.length - 1];
        next[last] = (next[last] ?? 0) + dmgLeft;
      }
    }

    setAssigned(normalizeAssignments(next));
  }

  function confirm() {
    if (remaining !== 0 || !isLegallyOrderedState(assigned)) return;
    respond({
      type: "combatDamageAssignmentDecision",
      assignments: assignees.map((assigneeId) => ({
        assigneeId,
        damage: assigned[assigneeId] ?? 0,
      })),
    });
  }
  useModalKeyboard(
    { onSpace: remaining === 0 && isLegallyOrderedState(assigned) ? confirm : undefined },
    [remaining, assigned],
  );

  return (
    <Modal maxWidth="max-w-md" className="outline-none">
      <Modal.Header>
        <h2 className="font-semibold text-base">Assign Combat Damage</h2>
        {attacker && (
          <p className="text-xs text-muted-foreground">
            {attacker.name} must assign {totalDamage} damage.
          </p>
        )}
      </Modal.Header>

      <div className="mt-4 px-4 pb-4 flex flex-col gap-2">
        {defendingPlayer && defenderDamage > 0 && (
          <div className="text-xs flex items-center gap-1.5 px-1">
            <span className="text-muted-foreground">{defendingPlayer.name}:</span>
            <span className="font-semibold">{defendingPlayer.life}</span>
            <span className="text-muted-foreground">→</span>
            <span
              className={cn(
                "font-semibold",
                defendingPlayer.life - defenderDamage <= 0 && "text-destructive",
              )}
            >
              {defendingPlayer.life - defenderDamage}
            </span>
          </div>
        )}
        {assignees.map((id, index) => {
          const dmg = assigned[id] ?? 0;
          const lethal = id === defenderId ? null : getLethal(id);
          const blocked = !canAssignToIndex(index);
          const willDie = lethal != null && lethal > 0 && dmg >= lethal;
          return (
            <div
              key={id}
              className={cn(
                "flex items-center gap-2 border rounded-md px-3 py-2",
                willDie && "border-destructive/70 bg-destructive/10",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                  {getLabel(id)}
                  {willDie && (
                    <span className="text-[10px] font-bold text-destructive uppercase tracking-wide">
                      💀 lethal
                    </span>
                  )}
                </div>
                {lethal != null && (
                  <div className="text-xs text-muted-foreground">Lethal: {lethal}</div>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => addDamage(id, index, -1)}>
                -
              </Button>
              <div className="w-8 text-center text-sm font-semibold">{dmg}</div>
              <Button
                size="sm"
                variant="outline"
                disabled={blocked || remaining <= 0}
                onClick={() => addDamage(id, index, 1)}
              >
                +
              </Button>
            </div>
          );
        })}

        <div className="text-xs text-muted-foreground pt-1">Remaining damage: {remaining}</div>

        <div className="flex justify-between pt-2">
          <Button size="sm" variant="ghost" onClick={() => setAssigned({})}>
            Reset
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={autoAssign}>
              Auto
            </Button>
            <Button
              size="sm"
              onClick={confirm}
              disabled={remaining !== 0 || !isLegallyOrderedState(assigned)}
            >
              Confirm
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
