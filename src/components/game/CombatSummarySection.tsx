import { useState } from "react";
import { Info, ShieldAlert, Swords, Zap } from "lucide-react";
import type { CardDto } from "@/protocol/game";
import type { PromptActionType, CombatAssignment } from "./game.types";
import { Modal } from "./modals/Modal";
import { useGameDevStore } from "@/stores/useGameDevStore";

interface CombatSummarySectionProps {
  promptType?: PromptActionType;
  attackerIds: string[];
  pendingAttackers: string[];
  blockAssignments: CombatAssignment[];
  resolveCardName: (cardId: string) => string;
  resolveCard: (cardId: string) => CardDto | undefined;
  defenderLife?: number;
}

function powerOf(card: CardDto | undefined): number {
  if (!card?.power) return 0;
  const n = parseInt(card.power, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function unblockedDamageOf(card: CardDto | undefined): number {
  const damage = powerOf(card);
  const hasDoubleStrike = card?.keywords?.some((keyword) =>
    keyword.toLowerCase().startsWith("double strike"),
  );
  return hasDoubleStrike ? damage * 2 : damage;
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
  defenderLife,
}: CombatSummarySectionProps) {
  const [open, setOpen] = useState(false);
  const forceCombatSummary = useGameDevStore(
    (state) => state.gameStateOverrides.forceCombatSummary,
  );
  const isAttackDecl = promptType === "chooseAttackers";
  const isBlockDecl = promptType === "chooseBlockers";
  const activeAttackers = isAttackDecl ? pendingAttackers : attackerIds;
  const sample = forceCombatSummary && activeAttackers.length === 0;

  if (!isAttackDecl && !isBlockDecl && !sample) return null;
  if (activeAttackers.length === 0 && !sample) return null;

  const blockedAttackerIds = new Set(blockAssignments.map((assignment) => assignment.attackerId));
  const attackerCount = sample ? 3 : activeAttackers.length;
  const blockedCount = sample
    ? 1
    : activeAttackers.filter((id) => blockedAttackerIds.has(id)).length;
  const unblockedCount = attackerCount - blockedCount;
  const attackerPower = sample
    ? 11
    : activeAttackers.reduce((sum, id) => sum + powerOf(resolveCard(id)), 0);
  const blockerToughness = sample
    ? 5
    : blockAssignments.reduce((sum, assignment) => {
        return sum + toughnessOf(resolveCard(assignment.blockerId));
      }, 0);
  const incomingDamage = sample
    ? 7
    : activeAttackers.reduce((sum, id) => {
        return blockedAttackerIds.has(id) ? sum : sum + unblockedDamageOf(resolveCard(id));
      }, 0);
  const firstStrike =
    sample ||
    [...activeAttackers, ...blockAssignments.map((assignment) => assignment.blockerId)].some(
      (id) =>
        resolveCard(id)?.keywords?.some((keyword) => {
          const normalized = keyword.toLowerCase();
          return normalized.startsWith("first strike") || normalized.startsWith("double strike");
        }) ?? false,
    );
  const lethal = sample || (defenderLife != null && incomingDamage >= defenderLife);
  const showIncoming = isBlockDecl || sample;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-xs">
        <span className="flex items-center gap-1 font-semibold">
          <Swords className="h-3.5 w-3.5 text-destructive" />
          {attackerCount} {attackerCount === 1 ? "attacker" : "attackers"}
        </span>
        {showIncoming ? (
          <span className="text-muted-foreground">
            {blockedCount} blocked · {unblockedCount} open
          </span>
        ) : null}
        <span className={lethal ? "font-bold text-destructive" : "font-semibold"}>
          {showIncoming ? "Incoming" : "Through"} {incomingDamage}
        </span>
        {lethal ? (
          <span className="flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 font-bold uppercase tracking-wide text-destructive">
            <ShieldAlert className="h-3 w-3" />
            Lethal
          </span>
        ) : null}
        {firstStrike ? (
          <span className="flex items-center gap-1 text-warning">
            <Zap className="h-3 w-3" />
            First strike
          </span>
        ) : null}
        {isBlockDecl && !sample ? (
          <button
            type="button"
            className="relative ml-auto rounded p-0.5 text-muted-foreground transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:text-foreground"
            onClick={() => setOpen(true)}
            title="Combat breakdown"
            aria-label="Combat breakdown"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open ? (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-md">
          <Modal.Header>
            <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Combat</h2>
          </Modal.Header>
          <Modal.Body>
            <div className="mb-3 flex items-center justify-center gap-3 text-sm">
              <span className="flex items-center gap-1 font-semibold">
                <Swords className="h-4 w-4" />
                {attackerPower}
              </span>
              <span className="text-muted-foreground">vs</span>
              <span className="font-semibold">Defense {blockerToughness}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold text-destructive">Incoming {incomingDamage}</span>
            </div>
            <div className="flex flex-col gap-1">
              {attackerIds.map((attackerId) => {
                const blockers = blockAssignments.filter(
                  (assignment) => assignment.attackerId === attackerId,
                );
                const attacker = resolveCard(attackerId);
                return (
                  <div
                    key={attackerId}
                    className="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {attacker?.power ? (
                        <span className="shrink-0 rounded bg-destructive/15 px-1 text-[10px] font-bold text-destructive">
                          {ptLabel(attacker)}
                        </span>
                      ) : null}
                      <span className="truncate text-xs font-semibold">
                        {resolveCardName(attackerId)}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">←</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {blockers.length === 0 ? (
                        <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold italic text-destructive">
                          unblocked
                        </span>
                      ) : (
                        blockers.map((blocker) => {
                          const card = resolveCard(blocker.blockerId);
                          return (
                            <span
                              key={blocker.blockerId}
                              className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]"
                            >
                              {card?.toughness ? (
                                <span className="font-bold text-muted-foreground">
                                  {ptLabel(card)}
                                </span>
                              ) : null}
                              <span className="max-w-[120px] truncate">
                                {resolveCardName(blocker.blockerId)}
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
      ) : null}
    </>
  );
}
