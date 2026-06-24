import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Graphics } from "pixi.js";
import { useCard } from "@/stores/useScryfallStore";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { CardSprite } from "@/pixi/CardSprite";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { safeDestroy } from "@/pixi/board/pixiHelpers";
import { useTheme } from "@/hooks/useTheme";
import { useHandScale } from "@/hooks/useHandScale";
import { PlaymatLayer } from "@/pixi/board/PlaymatLayer";
import { computeBoardLayout } from "@/pixi/board/boardLayout";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { BG_ALPHA_IDLE, GAP, TABLE_RADIUS } from "@/pixi/constants";
import { hexToNum } from "@/pixi/colorUtils";
import type { PlaymatSettings } from "@/protocol/game";

export const PREVIEW_WIDTH = 560;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function useBattlefieldAspect(): number {
  const vScale = useHandScale();
  return useMemo(() => {
    const layout = computeBoardLayout(window.innerWidth, window.innerHeight, 1, "row");
    const handReserve = Math.round(0.55 * HAND_CARD_BASE.cardH * vScale) + GAP;
    const feltHeight = Math.max(1, layout.self.height - handReserve);
    return layout.self.width / feltHeight;
  }, [vScale]);
}

interface PlaymatPreviewArgs {
  playmat: string | undefined;
  settings: Required<PlaymatSettings>;
  onOffsetChange: (offset: { offsetX: number; offsetY: number }) => void;
}

export function usePlaymatPreview({ playmat, settings, onOffsetChange }: PlaymatPreviewArgs) {
  const theme = useTheme();
  const aspect = useBattlefieldAspect();
  const previewHeight = Math.round(PREVIEW_WIDTH / aspect);

  const sampleA = useCard({ name: "Serra Angel" });
  const sampleB = useCard({ name: "Tarmogoyf" });
  const sampleC = useCard({ name: "Llanowar Elves" });
  const previewCards = useMemo(
    () =>
      [sampleA, sampleB, sampleC]
        .filter((e): e is NonNullable<typeof e> => !!e)
        .map((e) => scryfallToSampleGameCard(e.info)),
    [sampleA, sampleB, sampleC],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const layerRef = useRef<PlaymatLayer | null>(null);
  const feltRef = useRef<Graphics | null>(null);
  const naturalRef = useRef<{ w: number; h: number }>({ w: 1, h: 1 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!playmat) return;
    const img = new Image();
    img.onload = () => {
      naturalRef.current = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
    };
    img.src = playmat;
  }, [playmat]);

  useEffect(() => {
    let disposed = false;
    const app = new Application();
    const felt = new Graphics();
    const layer = new PlaymatLayer();
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        await app.init({
          canvas,
          width: PREVIEW_WIDTH,
          height: previewHeight,
          backgroundColor: hexToNum(theme.gameTheme.canvas.background),
          antialias: true,
          autoDensity: true,
          resolution: Math.min(2, window.devicePixelRatio || 1),
        });
      } catch (err) {
        console.error("[pixi] playmat preview init failed:", err);
        return;
      }
      if (disposed) {
        app.destroy(true);
        return;
      }
      app.stage.addChild(felt, layer.container);
      appRef.current = app;
      layerRef.current = layer;
      feltRef.current = felt;
      setReady(true);
    })();
    return () => {
      disposed = true;
      setReady(false);
      layer.destroy();
      if (appRef.current) appRef.current.destroy(true);
      appRef.current = null;
      layerRef.current = null;
      feltRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const felt = feltRef.current;
    const app = appRef.current;
    if (!layer || !felt || !app) return;
    app.renderer.resize(PREVIEW_WIDTH, previewHeight);
    felt.clear();
    felt.roundRect(0, 0, PREVIEW_WIDTH, previewHeight, TABLE_RADIUS);
    felt.fill({ color: hexToNum(theme.gameTheme.canvas.background), alpha: BG_ALPHA_IDLE });
    layer.setImage(playmat);
    layer.setSettings(settings);
    layer.layout(
      { x: 0, y: 0, width: PREVIEW_WIDTH, height: previewHeight },
      { dropActive: false },
    );
  }, [ready, playmat, settings, previewHeight, theme.gameTheme.canvas.background]);

  useEffect(() => {
    const app = appRef.current;
    if (!ready || !app || previewCards.length === 0) return;
    const scale = (previewHeight * 0.62) / CARD_H;
    const cardW = CARD_W * scale;
    const gap = cardW * 0.16;
    const total = previewCards.length * cardW + (previewCards.length - 1) * gap;
    let x = (PREVIEW_WIDTH - total) / 2 + cardW / 2;
    const cy = previewHeight * 0.56;
    const sprites = previewCards.map((card) => {
      const sprite = new CardSprite(card);
      sprite.updateCardContent(card);
      sprite.eventMode = "none";
      sprite.scale.set(scale);
      sprite.x = x;
      sprite.y = cy;
      x += cardW + gap;
      app.stage.addChild(sprite);
      return sprite;
    });
    return () => {
      for (const sprite of sprites) safeDestroy(sprite);
    };
  }, [ready, previewCards, previewHeight]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (settings.fit !== "cover") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = {
      sx: e.clientX,
      sy: e.clientY,
      ox: settings.offsetX,
      oy: settings.offsetY,
      rectW: rect.width || PREVIEW_WIDTH,
      rectH: rect.height || previewHeight,
    };
    const move = (ev: PointerEvent) => {
      const { w: nw, h: nh } = naturalRef.current;
      const scale = Math.max(PREVIEW_WIDTH / nw, previewHeight / nh);
      const overflowX = nw * scale - PREVIEW_WIDTH;
      const overflowY = nh * scale - previewHeight;
      const dx = ((ev.clientX - start.sx) * PREVIEW_WIDTH) / start.rectW;
      const dy = ((ev.clientY - start.sy) * previewHeight) / start.rectH;
      onOffsetChange({
        offsetX: overflowX > 0 ? clamp01(start.ox - dx / overflowX) : start.ox,
        offsetY: overflowY > 0 ? clamp01(start.oy - dy / overflowY) : start.oy,
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return { canvasRef, previewWidth: PREVIEW_WIDTH, previewHeight, onPointerDown };
}
