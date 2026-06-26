import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Graphics } from "pixi.js";
import { useCard } from "@/stores/useScryfallStore";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { CardSprite } from "@/pixi/CardSprite";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { safeDestroy } from "@/pixi/board/pixiHelpers";
import { useTheme } from "@/hooks/useTheme";
import { useHandScale } from "@/hooks/useHandScale";
import { PlaymatLayer, clampPlaymatZoom } from "@/pixi/board/PlaymatLayer";
import { computeBoardLayout } from "@/pixi/board/boardLayout";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { BG_ALPHA_IDLE, GAP, TABLE_RADIUS } from "@/pixi/constants";
import { hexToNum } from "@/pixi/colorUtils";
import type { PlaymatSettings } from "@/protocol/game";

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function useBattlefieldMetrics(): { aspect: number; feltWidth: number } {
  const vScale = useHandScale();
  return useMemo(() => {
    const layout = computeBoardLayout(window.innerWidth, window.innerHeight, 1, "row");
    const handReserve = Math.round(0.55 * HAND_CARD_BASE.cardH * vScale) + GAP;
    const feltHeight = Math.max(1, layout.self.height - handReserve);
    return { aspect: layout.self.width / feltHeight, feltWidth: layout.self.width };
  }, [vScale]);
}

interface PlaymatPreviewArgs {
  playmat: string | undefined;
  settings: Required<PlaymatSettings>;
  onOffsetChange: (offset: { offsetX: number; offsetY: number }) => void;
  onZoomChange: (zoom: number) => void;
  showSampleCards: boolean;
}

export function usePlaymatPreview({
  playmat,
  settings,
  onOffsetChange,
  onZoomChange,
  showSampleCards,
}: PlaymatPreviewArgs) {
  const theme = useTheme();
  const { aspect, feltWidth } = useBattlefieldMetrics();
  const previewRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const previewWidth = Math.max(1, Math.round(containerWidth || feltWidth * 0.5));
  const previewHeight = Math.round(previewWidth / aspect);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  const gestureRef = useRef({
    fit: settings.fit,
    offsetX: settings.offsetX,
    offsetY: settings.offsetY,
    zoom: settings.zoom,
    previewWidth,
    previewHeight,
    onOffsetChange,
    onZoomChange,
  });
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
          width: previewWidth,
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
    app.renderer.resize(previewWidth, previewHeight);
    felt.clear();
    felt.roundRect(0, 0, previewWidth, previewHeight, TABLE_RADIUS);
    felt.fill({ color: hexToNum(theme.gameTheme.canvas.background), alpha: BG_ALPHA_IDLE });
    layer.setImage(playmat);
    layer.setSettings(settings);
    layer.layout({ x: 0, y: 0, width: previewWidth, height: previewHeight }, { dropActive: false });
  }, [ready, playmat, settings, previewWidth, previewHeight, theme.gameTheme.canvas.background]);

  useEffect(() => {
    const app = appRef.current;
    if (!ready || !app || previewCards.length === 0 || !showSampleCards) return;
    const scale = (previewHeight * 0.62) / CARD_H;
    const cardW = CARD_W * scale;
    const gap = cardW * 0.16;
    const total = previewCards.length * cardW + (previewCards.length - 1) * gap;
    let x = (previewWidth - total) / 2 + cardW / 2;
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
  }, [ready, previewCards, previewWidth, previewHeight, showSampleCards]);

  gestureRef.current = {
    fit: settings.fit,
    offsetX: settings.offsetX,
    offsetY: settings.offsetY,
    zoom: settings.zoom,
    previewWidth,
    previewHeight,
    onOffsetChange,
    onZoomChange,
  };

  // Native pointer listeners: single-pointer drag to reposition, two-finger
  // pinch to zoom. Reads live state via gestureRef so it binds only once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: {
      sx: number;
      sy: number;
      ox: number;
      oy: number;
      rectW: number;
      rectH: number;
    } | null = null;
    let pinch: { dist: number; zoom: number } | null = null;

    const onDown = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (g.fit !== "cover") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const rect = canvas.getBoundingClientRect();
        drag = {
          sx: e.clientX,
          sy: e.clientY,
          ox: g.offsetX,
          oy: g.offsetY,
          rectW: rect.width || g.previewWidth,
          rectH: rect.height || g.previewHeight,
        };
        pinch = null;
      } else if (pointers.size === 2) {
        drag = null;
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: g.zoom };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gestureRef.current;
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        g.onZoomChange(clampPlaymatZoom(pinch.zoom * (dist / pinch.dist)));
      } else if (drag) {
        const { w: nw, h: nh } = naturalRef.current;
        const scale =
          Math.max(g.previewWidth / nw, g.previewHeight / nh) * clampPlaymatZoom(g.zoom);
        const overflowX = nw * scale - g.previewWidth;
        const overflowY = nh * scale - g.previewHeight;
        const dx = ((e.clientX - drag.sx) * g.previewWidth) / drag.rectW;
        const dy = ((e.clientY - drag.sy) * g.previewHeight) / drag.rectH;
        g.onOffsetChange({
          offsetX: overflowX > 0 ? clamp01(drag.ox - dx / overflowX) : drag.ox,
          offsetY: overflowY > 0 ? clamp01(drag.oy - dy / overflowY) : drag.oy,
        });
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) drag = null;
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // Native non-passive listener so preventDefault actually stops the scroll
  // from bubbling to a scrollable modal; React's onWheel is passive.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      const g = gestureRef.current;
      if (g.fit !== "cover") return;
      e.preventDefault();
      const step = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      g.onZoomChange(clampPlaymatZoom(g.zoom * step));
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  return { canvasRef, previewRef, previewWidth, previewHeight };
}
