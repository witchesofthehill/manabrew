import { Ban, Check, Crosshair } from "lucide-react";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { ScryfallImg } from "@/components/ScryfallImg";
import { MODAL_CARD_THUMBNAIL } from "@/components/game/game.styles";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { cn } from "@/lib/utils";
import type { DeckCard } from "@/protocol/deck";
import { usePromptActionColors } from "./internal/promptActionTheme";

interface PromptLabelProps {
  label: string;
  sourceCard?: DeckCard;
  isWaitingForResponse?: boolean;
  completionLabel?: string;
  completionKind?: "done" | "cancel";
  onCompleteTargets?: () => void;
}

export function PromptLabel({
  label,
  sourceCard,
  isWaitingForResponse,
  completionLabel,
  completionKind,
  onCompleteTargets,
}: PromptLabelProps) {
  const minimal = useIsMobileGame();
  const promptActionColors = usePromptActionColors();
  const isCancel = completionKind === "cancel";
  const completionButton = onCompleteTargets ? (
    <PromptActionButton
      label={completionLabel ?? "Done"}
      icon={isCancel ? <Ban className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
      variant={isCancel ? "outline" : "default"}
      baseColor={isCancel ? promptActionColors.cancel : undefined}
      onClick={onCompleteTargets}
      disabled={isWaitingForResponse}
    />
  ) : null;

  return (
    <div
      className={cn(
        minimal
          ? "flex flex-col items-center gap-1.5 max-w-[13rem]"
          : "flex items-center gap-2 min-w-[60%] max-w-full",
      )}
    >
      {sourceCard && (
        <ScryfallImg
          src={sourceCard.uris.border_crop ?? sourceCard.uris.normal}
          alt={sourceCard.identity.name}
          className={cn(MODAL_CARD_THUMBNAIL, minimal && "mx-auto")}
        />
      )}
      <div className={cn("flex items-center gap-1.5", minimal ? "w-full" : "min-w-0 flex-1")}>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 h-9 px-3 rounded-lg border border-white/20 bg-white/5 text-white/80">
          <Crosshair className="h-3.5 w-3.5 shrink-0 animate-pulse" />
          <span className="text-xs font-semibold tracking-wide truncate">
            <DynamicTextRender text={label} />
          </span>
        </div>
        {completionButton}
      </div>
    </div>
  );
}
