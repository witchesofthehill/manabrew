import { Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getPromptActionButtonStyle,
  usePromptActionColors,
} from "@/components/prompts/internal/promptActionTheme";
import type { ChooseDamageOrderProps } from "./internal/types";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export function ChooseDamageOrder({
  isWaitingForResponse,
  orderedCount,
  totalCount,
  onConfirm,
  onUndo,
  onDefault,
}: ChooseDamageOrderProps) {
  const promptActionColors = usePromptActionColors();
  const actionStyle = getPromptActionButtonStyle(promptActionColors.attackAction);
  const isComplete = orderedCount >= totalCount && totalCount > 0;
  return (
    <div className="flex w-3/5 flex-col gap-1.5">
      <p className="text-xs italic text-muted-foreground text-center">
        {orderedCount === 0
          ? i18n._(msg`Click blockers in the order damage is dealt.`)
          : isComplete
            ? i18n._(msg`Order set \u2014 confirm to deal damage.`)
            : i18n._(msg`Click the next blocker (${orderedCount}/${totalCount}).`)}
      </p>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-9 flex-1 rounded-lg text-xs font-bold !border-0 !text-white transition-[filter] hover:brightness-105"
          onClick={onDefault}
          disabled={isWaitingForResponse}
          style={actionStyle}
        >
          <Trans>AUTO</Trans>
        </Button>
        {orderedCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-9 flex-1 rounded-lg text-xs font-bold !border-0 !text-white transition-[filter] hover:brightness-105"
            onClick={onUndo}
            disabled={isWaitingForResponse}
            style={actionStyle}
          >
            <Trans>UNDO</Trans>
          </Button>
        )}
      </div>
      {isComplete && (
        <Button
          size="sm"
          variant="outline"
          className="h-9 w-full rounded-lg text-sm font-black tracking-[0.12em] !border-0 !text-white transition-[filter,box-shadow] hover:brightness-105 gap-1.5"
          onClick={onConfirm}
          disabled={isWaitingForResponse}
          style={actionStyle}
        >
          <Trans>
            <Swords className="h-3.5 w-3.5" />
            CONFIRM ORDER
          </Trans>
        </Button>
      )}
    </div>
  );
}
