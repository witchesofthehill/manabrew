import { useState } from "react";
import { Info } from "lucide-react";
import type { CardDto } from "@/protocol/game";
import type { PromptActionType, CombatAssignment } from "./game.types";
import { Modal } from "./modals/Modal";

interface CombatSummarySectionProps {
  promptType?: PromptActionType;
  attackerIds: string[];
  pendingAttackers: string[];
  blockAssignments: CombatAssignment[];
  resolveCardName: (cardId: string) => string;
  resolveCard: (cardId: string) => CardDto | undefined;
}

function powerOf(card: CardDto | undefined): number {
  if (!card?.power) return 0;
  const n = parseInt(card.power, 10);
  return Number.isFinite(n) ? n : 0;
}

function toughnessOf(card: CardDto | undefined): number {
  if (!card?.toughness) return 0;
  const n = parseInt(card.toughness, 10);
  return Number.isFinite(n) ? n : 0;
}

function ptLabel(card: CardDto | undefined): string {
  if (!card?.power || !card?.toughness) return "";
  return `${card.power}/${card.toughness}`;
}

export function CombatSummarySection({
  promptType,
  attackerIds,
  pendingAttackers,
  blockAssignments,
  resolveCardName,
  resolveCard,
}: CombatSummarySectionProps) {
  const isAttackDecl = promptType === "chooseAttackers";
  const isBlockDecl = promptType === "chooseBlockers";
  if (!isAttackDecl && !isBlockDecl) return null;

  const activeAttackers = isAttackDecl ? pendingAttackers : attackerIds;
  if (activeAttackers.length === 0) return null;

  const attackerPower = activeAttackers.reduce((sum, id) => sum + powerOf(resolveCard(id)), 0);
  const blockerToughness = isBlockDecl
    ? blockAssignments.reduce((sum, a) => sum + toughnessOf(resolveCard(a.blockerId)), 0)
    : 0;
  const unblockedPower = isBlockDecl
    ? activeAttackers.reduce((sum, id) => {
        const blocked = blockAssignments.some((a) => a.attackerId === id);
        return blocked ? sum : sum + powerOf(resolveCard(id));
      }, 0)
    : attackerPower;

  if (isBlockDecl) {
    return (
      <BlockerCombatSummary
        unblockedPower={unblockedPower}
        attackerPower={attackerPower}
        blockerToughness={blockerToughness}
        attackerIds={attackerIds}
        blockAssignments={blockAssignments}
        resolveCardName={resolveCardName}
        resolveCard={resolveCard}
      />
    );
  }

  return (
    <div className="rounded-lg p-2 bg-destructive/10">
      <p className="text-xs font-semibold text-destructive mb-1">Combat</p>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold">⚔ {attackerPower}</span>
        <span className="text-muted-foreground">·</span>
        <span className="font-semibold text-destructive">Through {unblockedPower}</span>
      </div>
    </div>
  );
}

interface BlockerCombatSummaryProps {
  unblockedPower: number;
  attackerPower: number;
  blockerToughness: number;
  attackerIds: string[];
  blockAssignments: CombatAssignment[];
  resolveCardName: (cardId: string) => string;
  resolveCard: (cardId: string) => CardDto | undefined;
}

function BlockerCombatSummary({
  unblockedPower,
  attackerPower,
  blockerToughness,
  attackerIds,
  blockAssignments,
  resolveCardName,
  resolveCard,
}: BlockerCombatSummaryProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg px-2 py-1.5 bg-destructive/10 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="font-semibold text-destructive">Through {unblockedPower}</span>
      </div>
      <button
        type="button"
        className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(true)}
        title="Combat breakdown"
        aria-label="Combat breakdown"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-md">
          <Modal.Header>
            <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Combat</h2>
          </Modal.Header>
          <Modal.Body>
            <div className="flex items-center justify-center gap-3 text-sm mb-3">
              <span className="font-semibold">⚔ {attackerPower}</span>
              <span className="text-muted-foreground">vs</span>
              <span className="font-semibold">🛡 {blockerToughness}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold text-destructive">Through {unblockedPower}</span>
            </div>
            <div className="flex flex-col gap-1">
              {attackerIds.map((attackerId) => {
                const blockers = blockAssignments.filter((a) => a.attackerId === attackerId);
                const atkCard = resolveCard(attackerId);
                return (
                  <div
                    key={attackerId}
                    className="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {atkCard?.power && (
                        <span className="shrink-0 rounded bg-destructive/15 px-1 text-[10px] font-bold text-destructive">
                          {ptLabel(atkCard)}
                        </span>
                      )}
                      <span className="truncate text-xs font-semibold">
                        {resolveCardName(attackerId)}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-xs shrink-0">←</span>
                    <div className="flex flex-wrap items-center gap-1 min-w-0">
                      {blockers.length === 0 ? (
                        <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold italic text-destructive">
                          unblocked
                        </span>
                      ) : (
                        blockers.map((b) => {
                          const blkCard = resolveCard(b.blockerId);
                          return (
                            <span
                              key={b.blockerId}
                              className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]"
                            >
                              {blkCard?.toughness && (
                                <span className="font-bold text-muted-foreground">
                                  {ptLabel(blkCard)}
                                </span>
                              )}
                              <span className="truncate max-w-[120px]">
                                {resolveCardName(b.blockerId)}
                              </span>
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Modal.Body>
        </Modal>
      )}
    </div>
  );
}
