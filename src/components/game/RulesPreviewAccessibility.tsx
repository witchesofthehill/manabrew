import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { CardDto } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { cn } from "@/lib/utils";
import { useResolvedGameCard } from "@/hooks/useResolvedGameCard";
import { deriveCardPresentation, type CardPresentation } from "@/components/game/cardPresentation";
import {
  resolveRulesPreviewDisplay,
  type RulesPreviewDisplay,
} from "@/pixi/cardPreview/rulesCardPreviewPresentation";
import type { ScryfallCard } from "@/types/scryfall";
import {
  caseSections,
  caseSectionActive,
  levelBandActive,
  previewPanelState,
  suspendState,
  previewOwnsAction,
} from "@/pixi/cardPreview/previewMechanics";
import { printedPrototype } from "@/lib/cardPrototype";
import { i18n } from "@/i18n/i18n";
import { msg } from "@lingui/core/macro";

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
  onSelect: (action: HandActionOption, index: number) => void;
  onHold: () => void;
  onRelease: () => void;
  onOriginal?: () => void;
  onFlip?: () => void;
  onDismiss?: () => void;
}

function RulesPreviewOracleText({
  card,
  info,
  deckLayout,
  presentation,
  display,
  descriptionId,
}: Pick<Props, "card"> & {
  info: ScryfallCard | null;
  deckLayout: string | undefined;
  presentation: CardPresentation;
  display: RulesPreviewDisplay;
  descriptionId: string;
}) {
  const progression = display.currentFace ? presentation.progression?.rail : null;
  const layout = display.prototype
    ? "prototype"
    : /\bRoom\b/.test(info?.type_line ?? "")
      ? "room"
      : deckLayout;
  const suspended = suspendState(card);
  const prototype = printedPrototype(info?.oracle_text ?? "");
  const ranges = [...(info?.oracle_text ?? "").matchAll(/^LEVEL\s+([^\n]+)/gm)].map(
    (match) => match[1]!,
  );
  if (ranges.length)
    ranges.unshift(`0-${Math.max(0, Number(ranges[0]?.match(/\d+/)?.[0] ?? 1) - 1)}`);
  return (
    <div id={descriptionId} className="sr-only">
      <div aria-live="polite">
        {suspended && <p>{suspended}</p>}
        {display.stats && (
          <p>
            {i18n._(msg`Current power and toughness`)}: {display.stats.power}/
            {display.stats.toughness}
          </p>
        )}
        {card.isPrototyped !== undefined && prototype && (
          <p>{card.isPrototyped ? i18n._(msg`Prototyped`) : i18n._(msg`Not prototyped`)}</p>
        )}
        {ranges.map((range) => {
          const active = levelBandActive(range, card);
          return (
            <p key={range}>
              {i18n._(msg`Level`)} {range}
              {active === undefined
                ? ""
                : active
                  ? `: ${i18n._(msg`Active level`)}`
                  : `: ${i18n._(msg`Inactive level`)}`}
            </p>
          );
        })}
      </div>
      {progression && (
        <p aria-live="polite">
          {progression.kind === "saga" ? "Chapter" : "Level"} {progression.current} of{" "}
          {progression.max}
        </p>
      )}
      {display.sections.map((section, index) => {
        const state = previewPanelState(card, { faceIndex: section.faceIndex }, layout);
        const caseCard = /\bCase\b/.test(info?.type_line ?? "");
        const stats = prototype
          ? section.faceIndex === 1
            ? prototype
            : { power: info?.power, toughness: info?.toughness }
          : undefined;
        return (
          <section key={index} aria-label={section.name}>
            <h3>{section.name}</h3>
            {state && <p aria-live="polite">{state}</p>}
            {section.manaCost && (
              <p>
                {i18n._(msg`Mana cost`)}: {section.manaCost}
              </p>
            )}
            <p>{section.typeLine}</p>
            {stats?.power !== undefined && stats.toughness !== undefined && (
              <p>
                {i18n._(msg`Printed power and toughness`)}: {stats.power}/{stats.toughness}
              </p>
            )}
            {caseCard ? (
              caseSections(section.rulesText, section.canonicalRulesText).map((part, partIndex) => (
                <section
                  key={partIndex}
                  aria-label={
                    part.kind === "base"
                      ? i18n._(msg`Base ability`)
                      : part.kind === "toSolve"
                        ? i18n._(msg`To solve`)
                        : i18n._(msg`Solved ability`)
                  }
                >
                  {part.kind === "solved" && caseSectionActive(card, part.kind) !== undefined && (
                    <p aria-live="polite">
                      {card.isSolved
                        ? i18n._(msg`Solved · active`)
                        : i18n._(msg`Unsolved · inactive`)}
                    </p>
                  )}
                  <p>{part.text}</p>
                </section>
              ))
            ) : (
              <p>{section.rulesText}</p>
            )}
            {section.flavorText && <p>{section.flavorText}</p>}
          </section>
        );
      })}
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
  const resolved = useResolvedGameCard(card);
  const presentation = deriveCardPresentation(card);
  const display = resolveRulesPreviewDisplay({
    card,
    presentation,
    info: resolved.info,
    deckLayout: resolved.deckCard.layout,
    showBackFace,
    faceless: false,
  });
  const isBattleCard = /\bBattle\b/.test(
    resolved.info?.card_faces?.[0]?.type_line ?? resolved.info?.type_line ?? presentation.typeLine,
  );
  const [focus, setFocus] = useState<{ key: string; bounds: Bounds } | null>(null);
  const descriptionId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const focusHold = useRef<{ hold: () => void; release: () => void } | null>(null);
  const releaseFocusHold = useCallback(() => {
    const held = focusHold.current;
    focusHold.current = null;
    held?.release();
  }, []);
  const holdFocus = () => {
    if (focusHold.current) return;
    focusHold.current = { hold: onHold, release: onRelease };
    onHold();
  };
  const hidden =
    card.isFaceDown ||
    !card.identity.name ||
    ("visibility" in card && card.visibility === "hidden");

  useLayoutEffect(() => releaseFocusHold, [releaseFocusHold]);
  useLayoutEffect(() => {
    const containsFocus = sectionRef.current?.contains(document.activeElement) === true;
    const held = focusHold.current;
    if (held && (!containsFocus || held.hold !== onHold || held.release !== onRelease))
      releaseFocusHold();
    if (containsFocus) holdFocus();
  });

  if (hidden) {
    if (focus) setFocus(null);
    return null;
  }
  const controls = [
    ...actions.flatMap((action, index) =>
      previewOwnsAction(action, display, isBattleCard)
        ? [
            {
              key: `action-${index}`,
              label: [action.cost, action.label].filter(Boolean).join(": "),
              activate: () => {
                if (previewOwnsAction(action, display, isBattleCard)) onSelect(action, index);
              },
              actionIndex: index,
            },
          ]
        : [],
    ),
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
      ref={sectionRef}
      aria-label={`${card.identity.name} rules and actions`}
      onFocusCapture={holdFocus}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocus(null);
          releaseFocusHold();
        }
      }}
    >
      <RulesPreviewOracleText
        card={card}
        info={resolved.info}
        deckLayout={resolved.deckCard.layout}
        presentation={presentation}
        display={display}
        descriptionId={descriptionId}
      />
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
            aria-describedby={descriptionId}
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
