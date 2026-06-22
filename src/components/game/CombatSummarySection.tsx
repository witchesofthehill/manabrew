import type { CardDto } from "@/protocol/game";
import type { PromptActionType, CombatAssignment } from "./game.types";

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

  return (
    <div className="rounded-lg p-2 bg-destructive/10">
      <p className="text-xs font-semibold text-destructive mb-1">Combat</p>
      <div className="flex items-center gap-2 text-xs mb-1.5">
        <span className="font-semibold">⚔ {attackerPower}</span>
        {isBlockDecl && (
          <>
            <span className="text-muted-foreground">vs</span>
            <span className="font-semibold">🛡 {blockerToughness}</span>
          </>
        )}
        <span className="text-muted-foreground">·</span>
        <span className="font-semibold text-destructive">Through {unblockedPower}</span>
      </div>
      {isBlockDecl && (
        <div className="flex flex-col gap-0.5">
          {attackerIds.map((attackerId) => {
            const blockers = blockAssignments.filter((a) => a.attackerId === attackerId);
            const blockerNames = blockers.map((b) => resolveCardName(b.blockerId));
            return (
              <div key={attackerId} className="text-xs flex gap-1">
                <span className="font-semibold truncate">{resolveCardName(attackerId)}</span>
                <span className="text-muted-foreground">-&gt;</span>
                <span
                  className={
                    blockerNames.length === 0
                      ? "text-destructive italic"
                      : "text-muted-foreground truncate"
                  }
                >
                  {blockerNames.length === 0 ? "unblocked" : blockerNames.join(", ")}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
