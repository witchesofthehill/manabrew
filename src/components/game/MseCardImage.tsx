import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import { getMseRenderDecision, renderMseCard } from "@/lib/mseCardRenderer";
import { MseCardRenderError } from "@/lib/mseCardDecision";
import type { MseRenderDecision } from "@mse-renderer";
import { cn } from "@/lib/utils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { CardFoilOverlay } from "@/components/game/CardFoilOverlay";
import { ScryfallImg } from "@/components/ScryfallImg";
import { CARD_BACK_IMAGE_URL } from "./game.constants";

interface MseCardImageProps {
  card?: CardDto;
  deckCard?: DeckCard;
  faceIndex?: 0 | 1;
  className?: string;
  fallback?: ReactNode;
  loading?: "eager" | "lazy";
}

export function MseCardImage(props: MseCardImageProps) {
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
  return <MseCardCanvas key={hidden ? "hidden" : printingKey} {...props} hidden={hidden} />;
}

function MseCardCanvas({
  card,
  deckCard,
  faceIndex = card?.isTransformed ? 1 : 0,
  className,
  fallback,
  loading = "eager",
  hidden,
}: MseCardImageProps & { hidden: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(loading !== "lazy");
  const [result, setResult] = useState<{
    card?: CardDto;
    deckCard?: DeckCard;
    faceIndex: 0 | 1;
    locale: string;
    state: "ready" | "error";
    decision?: MseRenderDecision;
    failure?: string;
  }>();
  const [hasImage, setHasImage] = useState(false);
  const locale = useScryfallStore((store) => store.locale);
  const foil = !hidden && (card ? card.foil : deckCard?.identity.foil);
  const state =
    result?.card === card &&
    result?.deckCard === deckCard &&
    result?.faceIndex === faceIndex &&
    result?.locale === locale
      ? result.state
      : "loading";
  const name = hidden
    ? "Face-down card"
    : (card?.identity.name ?? deckCard?.identity.name ?? "Card");
  const fallbackUrl = faceIndex === 1 ? deckCard?.backFace?.uris.normal : deckCard?.uris?.normal;

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
    void renderMseCard({ card, deckCard, faceIndex }, controller.signal)
      .then((image) => {
        if (controller.signal.aborted) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("Card canvas is unavailable");
        canvas.width = image.width;
        canvas.height = image.height;
        context.drawImage(image, 0, 0);
        setHasImage(true);
        setResult({
          card,
          deckCard,
          faceIndex,
          locale,
          state: "ready",
          decision: getMseRenderDecision(image),
        });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setHasImage(false);
          setResult({
            card,
            deckCard,
            faceIndex,
            locale,
            state: "error",
            decision: cause instanceof MseCardRenderError ? cause.decision : undefined,
            failure:
              cause instanceof MseCardRenderError && cause.decision.mode === "original"
                ? cause.decision.reason
                : "render-error",
          });
        }
      });
    return () => controller.abort();
  }, [card, deckCard, faceIndex, hidden, locale, loading, visible]);

  return (
    <div
      ref={hostRef}
      className={cn("relative block aspect-[5/7] overflow-hidden", className)}
      data-mse-state={hidden ? undefined : state}
      data-mse-template={
        state === "ready" && result?.decision?.mode === "native"
          ? result.decision.template
          : undefined
      }
      data-mse-fallback={state === "error" ? result?.failure : undefined}
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
            className={cn(
              "absolute inset-0 h-full w-full object-contain",
              !hasImage && "invisible",
            )}
          />
          <CardFoilOverlay enabled={!!foil} />
        </>
      )}
    </div>
  );
}
