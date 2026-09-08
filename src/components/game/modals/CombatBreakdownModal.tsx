import { useRef, useState, type CSSProperties } from "react";
import type { CardDto } from "@/protocol/game";
import type { CombatAssignment } from "@/components/game/game.types";
import { Card } from "@/components/game/Card";
import { summarizeCombat } from "@/components/game/combatSummary";
import { useKeybindings } from "@/hooks/useKeybindings";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { DialogCardInspector } from "./DialogCardInspector";
import { useCardInspection } from "./cardInspection";
import { Modal } from "./Modal";

export interface CombatBreakdownModalProps {
  attackerIds: string[];
  blockAssignments: CombatAssignment[];
  resolveCard: (id: string) => CardDto | undefined;
  resolveCardName: (id: string) => string;
  defenderLife?: number;
  onClose: () => void;
}
export function CombatBreakdownModal({
  attackerIds,
  blockAssignments,
  resolveCard,
  resolveCardName,
  defenderLife,
  onClose,
}: CombatBreakdownModalProps) {
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const inspected = inspectedId ? resolveCard(inspectedId) : undefined;
  const inspection = useCardInspection();
  const shortcutScope = useRef<HTMLDivElement>(null);
  const cardRing = useTheme().gameTheme.cardRing;
  useKeybindings({ "toggle-combat-breakdown": onClose }, shortcutScope);
  const cardHoverStyle = {
    "--combat-card-ring": cardRing,
    "--combat-card-glow": withAlpha(cardRing, 0.66),
  } as CSSProperties;
  const summary = summarizeCombat(attackerIds, blockAssignments, resolveCard);
  const inspectButton = (id: string) => {
    const card = resolveCard(id);
    return (
      <button
        key={id}
        type="button"
        className="group flex min-h-12 min-w-0 items-center gap-3 rounded-lg border border-transparent p-2 text-left focus-visible:outline-none"
        onClick={() => setInspectedId(id)}
        onFocus={() => setInspectedId(id)}
        disabled={!card}
      >
        {card && (
          <div
            className="w-14 shrink-0 rounded-lg motion-safe:transition-[box-shadow] motion-safe:duration-150 group-hover:ring-2 group-hover:ring-[var(--combat-card-ring)] group-hover:shadow-[0_0_18px_var(--combat-card-glow)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--combat-card-ring)] group-focus-visible:shadow-[0_0_18px_var(--combat-card-glow)]"
            style={cardHoverStyle}
          >
            <Card card={card} bare style={{ width: "100%" }} className="border-0" />
          </div>
        )}
        <span className="min-w-0 break-words text-sm">
          <span className="block font-semibold">{resolveCardName(id)}</span>
          {card?.power != null && (
            <span className="text-xs text-muted-foreground">
              {card.power}/{card.toughness}
            </span>
          )}
        </span>
      </button>
    );
  };
  return (
    <Modal maxWidth="max-w-5xl" className="h-[85dvh]" onClose={onClose}>
      <Modal.Header onClose={onClose}>
        <h2 className="text-base font-semibold">Combat breakdown</h2>
        <p className="text-xs text-muted-foreground">
          {summary.attackerCount} attackers · {summary.blockedCount} blocked ·{" "}
          {summary.unblockedCount} unblocked
        </p>
      </Modal.Header>
      <Modal.Instructions>
        Estimated unblocked damage: {summary.estimatedDamage}
        {defenderLife != null ? ` · Defender life: ${defenderLife}` : ""}. This estimate does not
        model trample, prevention or replacement effects.
      </Modal.Instructions>
      <Modal.Body className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div ref={shortcutScope} className="min-w-0 space-y-3">
          {attackerIds.map((id) => {
            const blockers = blockAssignments.filter((block) => block.attackerId === id);
            return (
              <article key={id} className="rounded-xl border bg-background/50 p-2">
                <p className="px-2 text-[10px] font-semibold uppercase text-muted-foreground">
                  Attacker
                </p>
                {inspectButton(id)}
                <div className="ml-4 border-l border-border pl-2">
                  <p className="px-2 text-xs text-muted-foreground">
                    {blockers.length ? "Blocked by" : "Unblocked"}
                  </p>
                  {blockers.map((block) => inspectButton(block.blockerId))}
                </div>
              </article>
            );
          })}
          {!attackerIds.length && <Modal.EmptyState message="No current combat assignments." />}
        </div>
        <div>
          {inspected ? (
            <DialogCardInspector
              card={inspected}
              state={inspection.stateFor(inspected)}
              onChange={(state) => inspection.change(inspected.id, state)}
            />
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              Select an attacker or blocker to inspect its realistic or rules view. Inspection does
              not change assignments.
            </p>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close onClose={onClose} variant="outline">
          Return to combat
        </Modal.Close>
      </Modal.Footer>
    </Modal>
  );
}
