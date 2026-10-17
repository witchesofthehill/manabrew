import { useState } from "react";
import type { CardDto } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { cn } from "@/lib/utils";
import { useResolvedGameCard } from "@/hooks/useResolvedGameCard";
import { deriveCardPresentation } from "@/components/game/cardPresentation";
import { resolveRulesPreviewDisplay } from "@/pixi/cardPreview/rulesCardPreviewPresentation";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Props {
  card: CardDto;
  showBackFace: boolean;
  actions: HandActionOption[];
  onFocusAction: (index: number) => Bounds | null;
  cardBounds: () => Bounds | null;
  onSelect: (action: HandActionOption) => void;
  onHold: () => void;
  onRelease: () => void;
  onOriginal?: () => void;
  onFlip?: () => void;
  onDismiss?: () => void;
}

function RulesPreviewOracleText({ card, showBackFace }: Pick<Props, "card" | "showBackFace">) {
  const { info, deckCard } = useResolvedGameCard(card);
  const presentation = deriveCardPresentation(card);
  const display = resolveRulesPreviewDisplay({
    card,
    presentation,
    info,
    deckLayout: deckCard.layout,
    showBackFace,
    faceless: false,
  });
  const progression = display.currentFace ? presentation.progression?.rail : null;
  return (
    <div className="sr-only">
      {progression && (
        <p aria-live="polite">
          {progression.kind === "saga" ? "Chapter" : "Level"} {progression.current} of{" "}
          {progression.max}
        </p>
      )}
      {display.sections.map((section, index) => (
        <section key={index} aria-label={section.name}>
          <h3>{section.name}</h3>
          <p>{section.typeLine}</p>
          <p>{section.rulesText}</p>
          {section.flavorText && <p>{section.flavorText}</p>}
        </section>
      ))}
    </div>
  );
}

export function RulesPreviewAccessibility({
  card,
  showBackFace,
  actions,
  onFocusAction,
  cardBounds,
  onSelect,
  onHold,
  onRelease,
  onOriginal,
  onFlip,
  onDismiss,
}: Props) {
  const [focus, setFocus] = useState<{ key: string; bounds: Bounds } | null>(null);
  if (
    card.isFaceDown ||
    !card.identity.name ||
    ("visibility" in card && card.visibility === "hidden")
  )
    return null;
  const controls = [
    ...actions.map((action, index) => ({
      key: `action-${index}`,
      label: [action.cost, action.label].filter(Boolean).join(": "),
      activate: () => onSelect(action),
      actionIndex: index,
    })),
    ...[
      { key: "original", label: "Show Realistic card", activate: onOriginal },
      { key: "flip", label: "Flip card face", activate: card.isDoubleFaced ? onFlip : undefined },
      { key: "dismiss", label: "Close card preview", activate: onDismiss },
    ]
      .filter((control) => control.activate)
      .map((control) => ({ ...control, actionIndex: undefined })),
  ];
  return (
    <section
      aria-label={`${card.identity.name} rules and actions`}
      onFocusCapture={onHold}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocus(null);
          onRelease();
        }
      }}
    >
      <RulesPreviewOracleText card={card} showBackFace={showBackFace} />
      {controls.map((control) => {
        const focused = focus?.key === control.key;
        return (
          <button
            type="button"
            key={control.key}
            className={cn(
              focused
                ? "fixed z-[10002] rounded border-2 border-ring pointer-events-none focus-visible:outline-none"
                : "sr-only",
              focused &&
                (control.actionIndex === undefined
                  ? "bg-popover text-popover-foreground text-sm"
                  : "bg-transparent"),
            )}
            style={
              focused
                ? {
                    left: focus.bounds.x,
                    top: focus.bounds.y,
                    width: focus.bounds.width,
                    height: focus.bounds.height,
                  }
                : undefined
            }
            aria-label={control.label}
            onFocus={() => {
              const bounds =
                control.actionIndex === undefined
                  ? cardBounds()
                  : onFocusAction(control.actionIndex);
              if (bounds)
                setFocus({
                  key: control.key,
                  bounds:
                    control.actionIndex === undefined
                      ? {
                          x: bounds.x + 8,
                          y: bounds.y + 8,
                          width: Math.max(1, bounds.width - 16),
                          height: 40,
                        }
                      : bounds,
                });
            }}
            onClick={control.activate}
          >
            <span className={control.actionIndex !== undefined ? "sr-only" : undefined}>
              {control.label}
            </span>
          </button>
        );
      })}
    </section>
  );
}
