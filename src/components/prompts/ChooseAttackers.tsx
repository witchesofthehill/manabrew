import { Ban, Crosshair, Sword, Swords } from "lucide-react";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { usePromptActionColors } from "@/components/prompts/internal/promptActionTheme";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { ATTACK_DRAG_HINT } from "@/components/game/panels/promptContextHints";
import type { ChooseAttackersProps } from "./internal/types";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export function ChooseAttackers({
  isWaitingForResponse,
  availableAttackerIds,
  pendingAttackers,
  attackAssignmentCount,
  selectedDefenderId,
  multipleDefenders,
  mustAttackHint,
  onPassPriority,
  onDeclareAttackers,
  onBeginAttackTargetPick,
  onSubmitAttack,
}: ChooseAttackersProps) {
  const promptActionColors = usePromptActionColors();
  const minimal = useIsMobileGame();
  const attackAllClick = multipleDefenders
    ? () => onBeginAttackTargetPick(availableAttackerIds)
    : () => onDeclareAttackers(availableAttackerIds, selectedDefenderId ?? undefined);
  const attackCount = attackAssignmentCount + pendingAttackers.length;
  const attackClick = onSubmitAttack;
  return (
    <div className="flex flex-col items-center gap-1.5">
      {!minimal && mustAttackHint && (
        <p className="text-center text-[11px] font-medium text-muted-foreground">
          {mustAttackHint}
        </p>
      )}
      {!minimal &&
        (pendingAttackers.length > 0 ? (
          <p className="flex animate-pulse items-center justify-center gap-1.5 text-center text-[11px] font-bold text-foreground">
            <Trans>
              <Crosshair className="h-3.5 w-3.5 shrink-0" />
              Pick a target — click an opponent or planeswalker
            </Trans>
          </p>
        ) : (
          <p className="text-center text-[11px] text-muted-foreground/70">{ATTACK_DRAG_HINT}</p>
        ))}
      <div className="flex flex-row items-center justify-center gap-1.5">
        <PromptActionButton
          label={i18n._(msg`Attack All`)}
          icon={<Swords className="h-3.5 w-3.5" />}
          baseColor={promptActionColors.attackAction}
          onClick={attackAllClick}
          disabled={isWaitingForResponse}
        />
        <PromptActionButton
          label={!minimal && attackCount > 0 ? `Attack (${attackCount})` : "Attack"}
          icon={<Sword className="h-3.5 w-3.5" />}
          baseColor={promptActionColors.attackAction}
          badge={minimal && attackCount > 0 ? String(attackCount) : undefined}
          onClick={attackClick}
          disabled={isWaitingForResponse || attackCount === 0}
        />
        <PromptActionButton
          label={i18n._(msg`Pass`)}
          icon={<Ban className="h-3.5 w-3.5" />}
          variant="outline"
          baseColor={promptActionColors.passAction}
          onClick={onPassPriority}
          disabled={isWaitingForResponse}
        />
      </div>
    </div>
  );
}
