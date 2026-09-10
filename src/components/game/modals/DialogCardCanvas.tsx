import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Application } from "pixi.js";
import type { CardDto } from "@/protocol/game";
import { CardSprite, setCardSpriteTheme } from "@/pixi/CardSprite";
import { destroyPixiApp, installPixiPatches } from "@/pixi/pixiPatches";
import { OverlayRenderScheduler, overlayResolution } from "@/pixi/overlay/overlayRuntime";
import { useTheme } from "@/hooks/useTheme";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useGameStore } from "@/stores/useGameStore";
import { asGameDeckCard } from "@/lib/decks";
import { isFacelessCard } from "@/lib/gameCard";
import { CARD_W, CARD_H, GAME_CARD_SIZES } from "@/components/game/game.constants";
import { animationsEnabled } from "@/pixi/effects/enabled";
import type { CardInspectionState } from "./cardInspection";

installPixiPatches();

interface Props {
  card: CardDto;
  state: CardInspectionState;
  onChange: (state: CardInspectionState) => void;
  highlight?: string;
}

export function DialogCardCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const updateRef = useRef<(() => void) | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  }, [props]);
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCardSpriteTheme(theme);
    updateRef.current?.();
  }, [theme]);
  useEffect(() => {
    const canvas = canvasRef.current!;
    const host = canvas.parentElement!;
    const app = new Application();
    let disposed = false;
    let initialized = false;
    let sprite: CardSprite | null = null;
    let scheduler: OverlayRenderScheduler | null = null;
    let observer: ResizeObserver | null = null;
    let unsubscribe: (() => void) | null = null;
    let activeUntil = 0;
    const request = () => {
      activeUntil = performance.now() + 250;
      scheduler?.request();
    };
    const layout = () => {
      if (!sprite || !initialized) return;
      const { state } = latest.current;
      const horizontal = sprite.horizontalFrame;
      const rotated = horizontal && state.rotated;
      const width = horizontal && !rotated ? CARD_H : CARD_W;
      const height = horizontal && !rotated ? CARD_W : CARD_H;
      const maxWidth =
        horizontal && !rotated ? GAME_CARD_SIZES.preview.height : GAME_CARD_SIZES.preview.width;
      const maxHeight =
        horizontal && !rotated ? GAME_CARD_SIZES.preview.width : GAME_CARD_SIZES.preview.height;
      const scale = Math.min(
        maxWidth / width,
        maxHeight / height,
        (host.clientWidth - 20) / width,
        (host.clientHeight - 20) / height,
      );
      sprite.rotation = rotated ? -Math.PI / 2 : 0;
      sprite.scale.set(Math.max(0.1, scale));
      sprite.position.set(host.clientWidth / 2, host.clientHeight / 2);
      sprite.syncHandControlsScale();
      request();
    };
    const update = () => {
      if (!initialized || disposed) return;
      const { card, state, onChange, highlight } = latest.current;
      if (!sprite || sprite.card.id !== card.id) {
        sprite?.destroy({ children: true });
        sprite = new CardSprite(card, "hand");
        sprite.onReorient = layout;
        app.stage.addChild(sprite);
      } else sprite.updateCardContent(card);
      sprite.setPreviewFace(state.face);
      sprite.setHandRulesView(state.rules && !isFacelessCard(card));
      sprite.setHandRulesHighlight(highlight ?? "");
      sprite.setRing(null);
      sprite.setHandControls(
        isFacelessCard(card)
          ? null
          : {
              rulesView: state.rules,
              horizontal: sprite.horizontalFrame && !card.isDoubleFaced,
              alternateFace: card.isDoubleFaced ? state.face === 1 : !state.rotated,
              showFaceControl: card.isDoubleFaced || sprite.horizontalFrame,
              onToggleRules: () => onChange({ ...state, rules: !state.rules }),
              onToggleFace: () =>
                onChange(
                  card.isDoubleFaced
                    ? { ...state, face: state.face === 0 ? 1 : 0, rotated: false }
                    : { ...state, rotated: !state.rotated },
                ),
            },
      );
      layout();
      if (!isFacelessCard(card)) {
        const deck = asGameDeckCard(useGameStore.getState().gameDecks, card);
        void useScryfallStore
          .getState()
          .getCardTexture(deck, state.rules ? "art" : "full", state.face)
          .then(request, request);
      }
    };
    void (async () => {
      try {
        await app.init({
          canvas,
          width: Math.max(1, host.clientWidth),
          height: Math.max(1, host.clientHeight),
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          autoStart: false,
          resolution: overlayResolution(host.clientWidth, host.clientHeight),
        });
        initialized = true;
        if (disposed) {
          destroyPixiApp(app);
          return;
        }
        app.stage.eventMode = "static";
        scheduler = new OverlayRenderScheduler(
          app,
          () =>
            host.clientWidth > 0 &&
            host.clientHeight > 0 &&
            !!sprite &&
            (!sprite.imageSettled ||
              performance.now() < activeUntil ||
              (animationsEnabled() && (!!latest.current.highlight || !!latest.current.card.foil))),
        );
        updateRef.current = update;
        observer = new ResizeObserver(() => {
          if (host.clientWidth <= 0 || host.clientHeight <= 0) return;
          app.renderer.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
          layout();
        });
        observer.observe(host);
        unsubscribe = useScryfallStore.subscribe(request);
        canvas.addEventListener("pointermove", request);
        canvas.addEventListener("pointerdown", request);
        canvas.addEventListener("wheel", request);
        update();
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      disposed = true;
      updateRef.current = null;
      observer?.disconnect();
      unsubscribe?.();
      scheduler?.dispose();
      canvas.removeEventListener("pointermove", request);
      canvas.removeEventListener("pointerdown", request);
      canvas.removeEventListener("wheel", request);
      sprite?.destroy({ children: true });
      if (initialized) destroyPixiApp(app);
    };
  }, []);
  useEffect(() => {
    updateRef.current?.();
  }, [props.card, props.state.rules, props.state.face, props.state.rotated, props.highlight]);
  return (
    <div className="relative h-[min(52dvh,32rem)] min-h-56 w-full" aria-hidden="true">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {error && (
        <p className="absolute inset-4 rounded-lg bg-card p-3 text-sm text-destructive">
          Card renderer unavailable: {error}
        </p>
      )}
    </div>
  );
}
