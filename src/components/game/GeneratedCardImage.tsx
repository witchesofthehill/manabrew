import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import { cardRenderInputKey, getCardRenderDecision, renderCard } from "@/lib/cardRenderer";
import type { CardRenderRequest } from "@/lib/cardRenderer";
import {
  recordCardRasterCopy,
  releaseCardRaster,
  retainCardRaster,
  selectCardRenderTier,
  type CardRenderTier,
} from "@/lib/cardRenderTypes";
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
import type { CardLightingMode, CardPose } from "@/lib/cardLighting";
import { gameCardFaceIndex } from "@/lib/gameCard";

interface GeneratedCardImageProps {
  card?: CardDto;
  deckCard?: DeckCard;
  faceIndex?: 0 | 1;
  className?: string;
  fallback?: ReactNode;
  loading?: "eager" | "lazy";
  lighting?: CardLightingMode;
  pose?: CardPose;
}

export function GeneratedCardImage(props: GeneratedCardImageProps) {
  const hidden = props.card
    ? props.card.isFaceDown ||
      !props.card.identity.name ||
      ("visibility" in props.card && props.card.visibility === "hidden")
    : false;
  const identity = props.card?.id ?? (props.deckCard?.identity.id || props.deckCard?.identity.name);
  return <GeneratedCardCanvas key={hidden ? "hidden" : identity} {...props} hidden={hidden} />;
}

function GeneratedCardCanvas({
  card,
  deckCard,
  faceIndex = card ? gameCardFaceIndex(card, deckCard?.layout) : 0,
  className,
  fallback,
  loading = "eager",
  hidden,
  lighting,
  pose,
}: GeneratedCardImageProps & { hidden: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const visibleRasterRelease = useRef<(() => void) | null>(null);
  const [tier, setTier] = useState<CardRenderTier>();
  const locale = useScryfallStore((store) => store.locale);
  const requestRef = useRef<CardRenderRequest>({ card, deckCard, faceIndex });
  const faceKey =
    hidden || (!card?.identity.name && !deckCard?.identity.name)
      ? null
      : JSON.stringify([cardRenderInputKey({ card, deckCard, faceIndex }), locale]);
  const renderKey = faceKey && JSON.stringify([faceKey, tier]);
  const pendingKeyRef = useRef(renderKey);
  const [visible, setVisible] = useState(loading !== "lazy");
  const [result, setResult] = useState<{
    key: string | null;
    state: "ready" | "error";
    decision?: CardRenderDecision;
    failure?: string;
  }>();
  const [raster, setRaster] = useState<{
    key: string | null;
    decision?: CardRenderDecision;
    artWindows?: readonly CardArtWindow[];
    liveHighlights?: CardLiveHighlightLayers;
  }>();
  const hasImage = !!raster && raster.key === faceKey;
  const decision = hasImage ? raster?.decision : result?.decision;
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
    pendingKeyRef.current = renderKey;
  }, [card, deckCard, faceIndex, renderKey]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || hidden) return;
    const measure = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setTier((previous) =>
          selectCardRenderTier(width, height, window.devicePixelRatio || 1, previous),
        );
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [hidden]);

  useLayoutEffect(() => {
    setRaster(undefined);
    return () => {
      visibleRasterRelease.current?.();
      visibleRasterRelease.current = null;
    };
  }, [faceKey]);

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
    if (hidden || !tier || (!visible && loading === "lazy")) return;
    const controller = new AbortController();
    void renderCard(requestRef.current, controller.signal, { tier })
      .then((image) => {
        try {
          if (controller.signal.aborted || pendingKeyRef.current !== renderKey) return;
          const canvas = canvasRef.current;
          const context = canvas?.getContext("2d");
          if (!canvas || !context) throw new Error("Card canvas is unavailable");
          const decision = getCardRenderDecision(image);
          const artWindows = getCardArtWindows(image);
          canvas.width = image.width;
          canvas.height = image.height;
          context.drawImage(image, 0, 0);
          recordCardRasterCopy(image.width, image.height, "dom");
          copyCardOpticalSource(image, canvas);
          copyCardLiveHighlights(image, canvas);
          const previousRelease = visibleRasterRelease.current;
          visibleRasterRelease.current = retainCardRaster(image);
          setRaster({
            key: faceKey,
            decision,
            artWindows,
            liveHighlights: getCardLiveHighlights(canvas),
          });
          setResult({
            key: renderKey,
            state: "ready",
            decision,
          });
          previousRelease?.();
          const request = requestRef.current;
          if (request.deckCard?.backFace) {
            void renderCard(
              { ...request, faceIndex: request.faceIndex === 1 ? 0 : 1 },
              controller.signal,
              { tier, priority: "background" },
            ).then(releaseCardRaster, () => undefined);
          }
        } finally {
          releaseCardRaster(image);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && pendingKeyRef.current === renderKey) {
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
  }, [renderKey, faceKey, hidden, loading, visible, tier]);

  return (
    <div
      ref={hostRef}
      className={cn("relative @container aspect-[5/7] rounded-[inherit]", className)}
      data-card-renderer={hidden ? undefined : (decision?.engine ?? "card-glint")}
      data-card-render-state={hidden ? undefined : state}
      data-card-render-template={hasImage ? raster?.decision?.template : undefined}
      data-card-render-fallback={state === "error" ? result?.failure : undefined}
      role="img"
      aria-label={name}
      aria-busy={!hidden && state === "loading"}
    >
      {hidden ? (
        <ScryfallImg
          src={CARD_BACK_IMAGE_URL}
          alt=""
          className="h-full w-full rounded-[inherit] object-contain"
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
                  className="h-full w-full rounded-[inherit] object-contain"
                  draggable={false}
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-card p-2 text-center text-ui-meta text-card-foreground">
                  {name}
                </span>
              )))}
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className={cn(
              "absolute inset-0 h-full w-full rounded-[inherit] object-fill",
              !hasImage && "invisible",
            )}
          />
          <CardFoilOverlay
            enabled={!hidden && visible}
            foil={!!foil}
            cosmetics={cosmetics}
            etched={isEtchedOnlyPrinting(printing?.info.finishes)}
            source={hasImage ? canvasRef.current : undefined}
            artWindows={hasImage ? raster?.artWindows : undefined}
            lighting={lighting}
            pose={pose}
          />
          <CardLiveHighlightOverlay
            enabled={!hidden && visible && hasImage}
            layers={hasImage ? raster?.liveHighlights : undefined}
          />
        </>
      )}
    </div>
  );
}
