import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import { cardRenderInputKey, getCardRenderDecision, renderCard } from "@/lib/cardRenderer";
import type { CardRenderRequest } from "@/lib/cardRenderer";
import { CardRenderError } from "@/lib/cardRenderDecision";
import type { CardRenderDecision } from "@/lib/cardRenderDecision";
import { getCardArtWindows, type CardArtWindow } from "@/lib/cardRenderGeometry";
import { copyCardOpticalSource } from "@/lib/cardOpticalLayers";
import {
  copyCardLiveHighlights,
  getCardLiveHighlights,
  type CardLiveHighlightLayers,
} from "@/lib/cardLiveHighlights";
import { cn } from "@/lib/utils";
import { useCard, useScryfallStore } from "@/stores/useScryfallStore";
import { isEtchedOnlyPrinting } from "@/lib/cardFinish";
import { CardFoilOverlay } from "@/components/game/CardFoilOverlay";
import { CardLiveHighlightOverlay } from "@/components/game/CardLiveHighlightOverlay";
import { ScryfallImg } from "@/components/ScryfallImg";
import { CARD_BACK_IMAGE_URL } from "./game.constants";

interface GeneratedCardImageProps {
  card?: CardDto;
  deckCard?: DeckCard;
  faceIndex?: 0 | 1;
  className?: string;
  fallback?: ReactNode;
  loading?: "eager" | "lazy";
}

export function GeneratedCardImage(props: GeneratedCardImageProps) {
  const hidden = props.card
    ? props.card.isFaceDown ||
      !props.card.identity.name ||
      ("visibility" in props.card && props.card.visibility === "hidden")
    : false;
  const identity = props.card?.id ?? (props.deckCard?.identity.id || props.deckCard?.identity.name);
  const faceIndex = props.faceIndex ?? (props.card?.isTransformed ? 1 : 0);
  const locale = useScryfallStore((store) => store.locale);
  const printingKey = JSON.stringify([
    identity,
    props.card?.identity,
    props.deckCard?.identity,
    props.deckCard?.uris.normal,
    props.deckCard?.backFace?.uris.normal,
    faceIndex,
    locale,
  ]);
  return <GeneratedCardCanvas key={hidden ? "hidden" : printingKey} {...props} hidden={hidden} />;
}

function GeneratedCardCanvas({
  card,
  deckCard,
  faceIndex = card?.isTransformed ? 1 : 0,
  className,
  fallback,
  loading = "eager",
  hidden,
}: GeneratedCardImageProps & { hidden: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<CardRenderRequest>({ card, deckCard, faceIndex });
  const renderKey =
    hidden || (!card?.identity.name && !deckCard?.identity.name)
      ? null
      : cardRenderInputKey({ card, deckCard, faceIndex });
  const [visible, setVisible] = useState(loading !== "lazy");
  const [result, setResult] = useState<{
    key: string | null;
    state: "ready" | "error";
    decision?: CardRenderDecision;
    artWindows?: readonly CardArtWindow[];
    liveHighlights?: CardLiveHighlightLayers;
    failure?: string;
  }>();
  const [hasImage, setHasImage] = useState(false);
  const foil = !hidden && (card ? card.foil : deckCard?.identity.foil);
  const cosmetics = hidden ? undefined : card ? card.cosmetics : deckCard?.identity.cosmetics;
  const identity = deckCard?.identity ?? card?.identity;
  const printing = useCard(
    hidden || !identity?.name
      ? null
      : {
          name: identity.name,
          setCode: identity.setCode || undefined,
          cardNumber: identity.cardNumber || undefined,
        },
  );
  const state = result?.key === renderKey ? result.state : "loading";
  const name = hidden
    ? "Face-down card"
    : (card?.identity.name ?? deckCard?.identity.name ?? "Card");
  const fallbackUrl = faceIndex === 1 ? deckCard?.backFace?.uris.normal : deckCard?.uris?.normal;

  useLayoutEffect(() => {
    requestRef.current = { card, deckCard, faceIndex };
  }, [card, deckCard, faceIndex]);

  useEffect(() => {
    if (visible || loading !== "lazy") return;
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [loading, visible]);

  useEffect(() => {
    if (hidden || (!visible && loading === "lazy")) return;
    const controller = new AbortController();
    void renderCard(requestRef.current, controller.signal)
      .then((image) => {
        if (controller.signal.aborted) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("Card canvas is unavailable");
        canvas.width = image.width;
        canvas.height = image.height;
        context.drawImage(image, 0, 0);
        copyCardOpticalSource(image, canvas);
        copyCardLiveHighlights(image, canvas);
        setHasImage(true);
        setResult({
          key: renderKey,
          state: "ready",
          decision: getCardRenderDecision(image),
          artWindows: getCardArtWindows(image),
          liveHighlights: getCardLiveHighlights(canvas),
        });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setHasImage(false);
          setResult({
            key: renderKey,
            state: "error",
            decision: cause instanceof CardRenderError ? cause.decision : undefined,
            failure:
              cause instanceof CardRenderError && cause.decision.mode === "original"
                ? cause.decision.reason
                : "render-error",
          });
        }
      });
    return () => controller.abort();
  }, [renderKey, hidden, loading, visible]);

  return (
    <div
      ref={hostRef}
      className={cn("relative @container aspect-[5/7] overflow-hidden", className)}
      data-card-renderer={hidden ? undefined : "card-glint"}
      data-card-render-state={hidden ? undefined : state}
      data-card-render-template={
        state === "ready" && result?.decision?.mode === "native"
          ? result.decision.template
          : undefined
      }
      data-card-render-fallback={state === "error" ? result?.failure : undefined}
      role="img"
      aria-label={name}
      aria-busy={!hidden && state === "loading"}
    >
      {hidden ? (
        <ScryfallImg
          src={CARD_BACK_IMAGE_URL}
          alt=""
          className="h-full w-full object-contain"
          draggable={false}
        />
      ) : (
        <>
          {!hasImage &&
            (fallback ??
              (fallbackUrl && !fallbackUrl.startsWith("data:") ? (
                <ScryfallImg
                  src={fallbackUrl}
                  alt=""
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center bg-card p-2 text-center text-xs text-card-foreground">
                  {name}
                </span>
              )))}
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className={cn("absolute inset-0 h-full w-full object-fill", !hasImage && "invisible")}
          />
          <CardFoilOverlay
            enabled={!hidden && visible}
            foil={!!foil}
            cosmetics={cosmetics}
            etched={isEtchedOnlyPrinting(printing?.info.finishes)}
            source={hasImage ? canvasRef.current : undefined}
            artWindows={hasImage ? result?.artWindows : undefined}
          />
          <CardLiveHighlightOverlay
            enabled={!hidden && visible && hasImage}
            layers={hasImage ? result?.liveHighlights : undefined}
          />
        </>
      )}
    </div>
  );
}
