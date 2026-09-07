import { CombatSummarySection } from "../CombatSummarySection";
import type { CardDto } from "@/protocol/game";
import type { PromptActionType, CombatAssignment, CombatPairing } from "../game.types";

interface CombatInfoProps {
  promptType?: PromptActionType;
  attackerIds: string[];
  pendingAttackers: string[];
  blockAssignments: CombatAssignment[];
  combatPairings: CombatPairing[];
  resolveCardName: (cardId: string) => string;
  resolveCard: (cardId: string) => CardDto | undefined;
}

export function CombatInfo({
  promptType,
  attackerIds,
  pendingAttackers,
  blockAssignments,
  combatPairings,
  resolveCardName,
  resolveCard,
}: CombatInfoProps) {
  return (
    <>
      {combatPairings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg bg-destructive/10 p-2">
          {combatPairings.map((p) => (
            <div key={p.key} className="flex items-center gap-1.5 text-xs">
              <span className="min-w-0 truncate font-semibold">{p.attacker}</span>
              <span className="shrink-0 text-muted-foreground">
                {p.attacker === "You" ? "attack" : "attacks"}
              </span>
              <span className="min-w-0 truncate font-semibold text-destructive">{p.defender}</span>
              {p.count > 1 && (
                <span className="ml-auto shrink-0 rounded bg-destructive/15 px-1 text-[10px] font-bold text-destructive">
                  ×{p.count}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <CombatSummarySection
        promptType={promptType}
        attackerIds={attackerIds}
        pendingAttackers={pendingAttackers}
        blockAssignments={blockAssignments}
        resolveCardName={resolveCardName}
        resolveCard={resolveCard}
      />
    </>
  );
}
