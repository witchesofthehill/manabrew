import { useMemo, useRef, type ReactNode } from "react";
import type { CardDto } from "@/protocol/game";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { useResolvedGameCard } from "@/hooks/useResolvedGameCard";
import { useKeybindings } from "@/hooks/useKeybindings";
import { isFacelessCard } from "@/lib/gameCard";
import { isHorizontalGameCard } from "@/lib/horizontalGameCard";
import { DialogCardCanvas } from "./DialogCardCanvas";
import type { CardInspectionState } from "./cardInspection";

interface Props {
  card: CardDto;
  state: CardInspectionState;
  onChange: (state: CardInspectionState) => void;
  highlight?: string;
  children?: ReactNode;
}

export function DialogCardInspector({ card, state, onChange, highlight, children }: Props) {
  const scope = useRef<HTMLElement>(null);
  const { cardFaces, deckCard } = useResolvedGameCard(card);
  const hidden = isFacelessCard(card);
  const flippable = !hidden && (card.isDoubleFaced || cardFaces.isFlippable);
  const inspectedCard = useMemo(() => ({ ...card, isDoubleFaced: flippable }), [card, flippable]);
  const horizontal = !hidden && isHorizontalGameCard(card, deckCard.layout, state.face);
  const view = () => {
    if (!hidden) onChange({ ...state, rules: !state.rules });
  };
  const flip = () => {
    if (flippable) onChange({ ...state, face: state.face === 0 ? 1 : 0, rotated: false });
    else if (horizontal) onChange({ ...state, rotated: !state.rotated });
  };
  useKeybindings({ "toggle-card-view": view, "flip-card": flip }, scope);
  const name = hidden
    ? "Face-down card"
    : (cardFaces.faces[state.face]?.name ?? card.identity.name);
  return (
    <section ref={scope} aria-label={`Inspect ${name}`} className="flex min-h-0 flex-col">
      <div className="sr-only">
        <h3>{name}</h3>
        <button type="button" tabIndex={-1} onClick={view} disabled={hidden}>
          {state.rules ? "Show realistic card" : "Show rules"}
        </button>
        {(flippable || horizontal) && (
          <button type="button" tabIndex={-1} onClick={flip}>
            {flippable ? (state.face ? "Show front face" : "Show back face") : "Rotate card"}
          </button>
        )}
      </div>
      <DialogCardCanvas
        card={inspectedCard}
        state={state}
        onChange={onChange}
        highlight={highlight}
      />
      {!hidden && (
        <div className="sr-only">
          <DynamicTextRender
            text={state.face === 0 ? card.text : (cardFaces.faces[state.face]?.oracleText ?? "")}
          />
        </div>
      )}
      {children && <div className="mt-3 space-y-2">{children}</div>}
    </section>
  );
}
