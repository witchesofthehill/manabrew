import { watchArenaImage } from "@/three/arenaImageCache";
import cardBack from "@/three/assets/card-back.png";
import { KeywordIcon } from "@/three/KeywordIcon";
import { useEffect, useRef, useState } from "react";
import type { ArenaCard } from "@/three/arena.types";
import { counterLabel, keywordDetails } from "@/three/keywordDetails";
import { ManaSymbol, ManaText } from "@/three/ManaSymbols";
import { manaCostSymbols } from "@/three/manaCostSymbols";

type Preview = Partial<
  Pick<
    ArenaCard,
    | "id"
    | "attachedToName"
    | "attachmentNames"
    | "image"
    | "name"
    | "keywords"
    | "counters"
    | "stats"
    | "damage"
    | "text"
    | "summoningSick"
    | "tapped"
    | "cost"
    | "effectiveCost"
  >
> & { id: string; name: string };

export function CardPreview({
  card,
  onInspect,
  hideDetails = false,
}: {
  card?: Preview;
  onInspect?: (id: string | null) => void;
  hideDetails?: boolean;
}) {
  const [shown, setShown] = useState<Preview>();
  const latest = useRef(card);
  useEffect(() => {
    latest.current = card;
  }, [card]);
  const id = card?.id,
    image = card?.image,
    name = card?.name;
  useEffect(() => {
    let cancelled = false;
    let stopImage: (() => void) | undefined;

    const timer = window.setTimeout(
      () => {
        if (!id || !name || !image) {
          setShown(undefined);
          return;
        }
        setShown({ ...latest.current, id, image: cardBack, name });
        stopImage = watchArenaImage(image, () => {
          if (!cancelled) setShown({ ...latest.current, id, image, name });
        });
      },
      id ? 90 : 180,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopImage?.();
    };
  }, [id, image, name]);
  if (!shown?.image) return null;
  const details = card?.id === shown.id ? card : shown;
  const keywords = [...new Set(details?.keywords ?? [])].map((raw) => ({
    raw,
    detail: keywordDetails(raw),
  }));
  const counters = Object.entries(details?.counters ?? {}).filter(([, count]) => count > 0);
  const printedCost = manaCostSymbols(details?.cost ?? "");
  const currentCost = manaCostSymbols(details?.effectiveCost ?? details?.cost ?? "");
  const costModified =
    details?.effectiveCost != null && printedCost.join(" ") !== currentCost.join(" ");
  return (
    <aside
      className="arena-preview"
      data-visible={Boolean(card)}
      aria-label={`${shown.name} details`}
    >
      <img
        key={`${shown.id}:${shown.image}`}
        crossOrigin="anonymous"
        data-loaded="true"
        src={shown.image}
        alt={shown.name}
      />
      {details && !hideDetails && (
        <div
          className="arena-card-details"
          onMouseEnter={() => onInspect?.(shown.id)}
          onMouseLeave={() => onInspect?.(null)}
        >
          {costModified && (
            <section className="arena-detail-state">
              <strong>Modified mana cost</strong>
              <p>
                Printed cost:{" "}
                {printedCost.map((symbol, index) => (
                  <ManaSymbol key={index} symbol={symbol} />
                ))}
              </p>
              <p>
                Current cost:{" "}
                {currentCost.map((symbol, index) => (
                  <ManaSymbol key={index} symbol={symbol} />
                ))}
                {!currentCost.length && "No mana required"}
              </p>
            </section>
          )}
          {(details.stats || counters.length > 0 || Boolean(details.damage)) && (
            <section className="arena-detail-state">
              {details.stats && (
                <strong>
                  Current power / toughness <b>{details.stats}</b>
                </strong>
              )}
              {counters.map(([type, count]) => (
                <div key={type}>
                  <span className="arena-counter-number">{count}</span>
                  <span>
                    {counterLabel(type)} {count === 1 ? "counter" : "counters"}
                  </span>
                </div>
              ))}
              {Boolean(details.damage) && (
                <div className="arena-damage-detail">{details.damage} damage marked this turn</div>
              )}
            </section>
          )}
          {details.attachedToName && (
            <section>
              <strong>Attached to {details.attachedToName}</strong>
            </section>
          )}
          {!!details.attachmentNames?.length && (
            <section>
              <strong>Attachments</strong>
              {details.attachmentNames.map((name, index) => (
                <p key={`${name}-${index}`}>{name}</p>
              ))}
            </section>
          )}
          {keywords.map(({ raw, detail }) => (
            <section className="arena-keyword-detail" key={raw}>
              {detail && <KeywordIcon path={detail.path} />}
              <div>
                <strong>{detail?.label ?? raw}</strong>
                {detail && <p>{detail.description}</p>}
              </div>
            </section>
          ))}
          {details.summoningSick && !keywords.some((k) => k.detail?.name === "Haste") && (
            <section>
              <strong>Summoning sickness</strong>
              <p>Cannot attack or use its tap or untap abilities yet.</p>
            </section>
          )}
          {details.text && (
            <section className="arena-rules-detail">
              <strong>Card text</strong>
              <p>
                <ManaText text={details.text} />
              </p>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
