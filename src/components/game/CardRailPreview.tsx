import { useId } from "react";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { GameIcon } from "@/components/game/GameIcon";
import type { CardRailEffect, CardRailState } from "./cardRailState";
import { getCardRailNotchAttributes, getCardRailRootAttributes } from "./cardRailState";
import { cn } from "@/lib/utils";
const RAIL_KIND_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "border-counter-lore/70",
  class: "border-counter-level/70",
};
const RAIL_ACCENT_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "bg-counter-lore",
  class: "bg-counter-level",
};
const RAIL_ACCENT_TEXT_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "text-counter-lore",
  class: "text-counter-level",
};
const RAIL_ACTIVE_ROW_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "bg-counter-lore/15",
  class: "bg-counter-level/15",
};
const RAIL_INTERACTIVE_ROW_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "bg-counter-lore/10 ring-1 ring-inset ring-counter-lore/70 hover:bg-counter-lore/20 focus-visible:ring-2 focus-visible:ring-counter-lore",
  class:
    "bg-counter-level/10 ring-1 ring-inset ring-counter-level/70 hover:bg-counter-level/20 focus-visible:ring-2 focus-visible:ring-counter-level",
};
interface CardRailPreviewInteraction {
  position: number;
  shortcut: number;
  label: string;
  onActivate: () => void;
}
interface CardRailPreviewProps {
  state: CardRailState;
  effects: CardRailEffect[];
  interactions?: CardRailPreviewInteraction[];
  className?: string;
}
export function CardRailPreview({
  state,
  effects,
  interactions = [],
  className,
}: CardRailPreviewProps) {
  const railInstanceId = useId();
  const effectByPosition = new Map(effects.map((effect) => [effect.position, effect]));
  const interactionByPosition = new Map(
    interactions.map((interaction) => [interaction.position, interaction]),
  );
  const title = state.kind === "saga" ? `Lore chapters` : `Class levels`;
  return (
    <section
      {...getCardRailRootAttributes(state, railInstanceId)}
      className={cn(
        "w-full overflow-hidden rounded-lg border border-border/80 bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-md",
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full bg-canvas-shadow/80",
            RAIL_ACCENT_TEXT_CLASSES[state.kind],
          )}
        >
          <GameIcon
            name={state.kind === "saga" ? "spell-book" : "rank-3"}
            className="h-4 w-4 fill-current"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-ui-meta font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {title}
          </span>
          <span className="block text-ui-meta font-semibold">
            {state.kind === "saga"
              ? state.current > 0
                ? `Chapter ${state.current} of ${state.max}`
                : `Awaiting first chapter`
              : state.current > 0
                ? `Level ${state.current} of ${state.max}`
                : `Awaiting first level`}
          </span>
        </span>
      </header>
      <div>
        {state.notches.map((notch) => {
          const effect = effectByPosition.get(notch.position);
          const interaction = interactionByPosition.get(notch.position);
          const Row = interaction ? "button" : "div";
          const interactionProps = interaction
            ? {
                type: "button" as const,
                onClick: interaction.onActivate,
                "aria-label": `${interaction.label} (${interaction.shortcut})`,
                "aria-keyshortcuts": String(interaction.shortcut),
              }
            : {};
          const rowClassName = cn(
            "relative grid w-full grid-cols-[2rem_1fr] gap-2 border-b border-border/50 px-3 py-2 text-left text-popover-foreground last:border-b-0",
            notch.active && RAIL_ACTIVE_ROW_CLASSES[state.kind],
            interaction && [
              "min-h-8 touch:min-h-11 touch:min-w-11 cursor-pointer transition-colors focus-visible:outline-none",
              RAIL_INTERACTIVE_ROW_CLASSES[state.kind],
            ],
          );
          return (
            <Row
              key={notch.id}
              {...getCardRailNotchAttributes(notch, railInstanceId)}
              {...interactionProps}
              className={rowClassName}
            >
              <div className="relative flex justify-center">
                {notch.position > 1 && (
                  <span
                    className={cn(
                      "absolute -top-2 bottom-1/2 w-0.5",
                      notch.reached ? RAIL_ACCENT_CLASSES[state.kind] : "bg-border",
                    )}
                  />
                )}
                {notch.position < state.max && (
                  <span
                    className={cn(
                      "absolute top-1/2 -bottom-2 w-0.5",
                      notch.position < state.current
                        ? RAIL_ACCENT_CLASSES[state.kind]
                        : "bg-border",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "relative z-10 flex min-h-7 min-w-7 items-center justify-center rounded-full border px-1 text-ui-meta font-black tabular-nums",
                    notch.active
                      ? cn(
                          RAIL_ACCENT_CLASSES[state.kind],
                          "border-text-on-tinted text-text-on-tinted ring-2 ring-canvas-shadow/70",
                        )
                      : notch.reached || interaction
                        ? cn(
                            RAIL_KIND_CLASSES[state.kind],
                            RAIL_ACCENT_TEXT_CLASSES[state.kind],
                            "bg-canvas-shadow/80",
                          )
                        : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {notch.label}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    {interaction && (
                      <kbd className="flex min-h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-ui-meta font-bold text-popover-foreground shadow-sm">
                        {interaction.shortcut}
                      </kbd>
                    )}
                    <span className="text-ui-meta font-bold uppercase tracking-wide text-muted-foreground">
                      {state.kind === "saga" ? `Chapter ${notch.label}` : `Level ${notch.label}`}
                    </span>
                  </span>
                  {effect?.cost && (
                    <span className="text-ui-meta font-semibold">
                      <DynamicTextRender text={effect.cost} />
                    </span>
                  )}
                </div>
                {effect?.label && (
                  <div className="mt-0.5 text-ui-label font-semibold leading-snug">
                    {effect.label}
                  </div>
                )}
                <div
                  className={cn(
                    "whitespace-pre-line break-words text-ui-body leading-snug",
                    !effect?.label && "mt-0.5",
                    notch.reached || interaction
                      ? "text-popover-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {effect?.text ? (
                    <DynamicTextRender text={effect.text} />
                  ) : (
                    <span>Effect text unavailable</span>
                  )}
                </div>
              </div>
            </Row>
          );
        })}
      </div>
    </section>
  );
}
