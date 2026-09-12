import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Graphics } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "@/pixi/pixiPatches";

installPixiPatches();

import { useCard, useScryfallStore } from "@/stores/useScryfallStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { asDeckCard } from "@/lib/decks";
import { CardSprite, setCardSpriteStyle, setCardSpriteTheme } from "@/pixi/CardSprite";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { safeDestroy } from "@/pixi/board/pixiHelpers";
import { useTheme } from "@/hooks/useTheme";
import { PlaymatLayer, clampPlaymatZoom } from "@/pixi/board/PlaymatLayer";
import { computeBoardLayout } from "@/pixi/board/boardLayout";
import { BG_ALPHA_IDLE, TABLE_RADIUS } from "@/pixi/constants";
import { hexToNum } from "@/pixi/colorUtils";
import { loadManaSymbolTexture } from "@/pixi/manaSymbolCache";
import { parseManaCost } from "@/pixi/manaSymbols";
import type { PlaymatSettings } from "@/protocol/game";

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function useBattlefieldMetrics(): { aspect: number; feltWidth: number } {
  return useMemo(() => {
    const layout = computeBoardLayout(window.innerWidth, window.innerHeight, 1);
    // The in-game playmat fills the FULL field height (BoardRegion.bandZone),
    // covering under the hand and player panel — so the preview aspect uses the
    // full self height too, no hand-reserve trim.
    const feltHeight = Math.max(1, layout.self.height);
    return { aspect: layout.self.width / feltHeight, feltWidth: layout.self.width };
  }, []);
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
  const cardStyle = usePreferencesStore((state) => state.battlefieldCardStyle);
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
  const requestRenderRef = useRef<() => void>(() => undefined);
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
    naturalRef.current = { w: 1, h: 1 };
    if (!playmat) return;
    let active = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!active) return;
      naturalRef.current = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
    };
    img.onerror = () => {
      if (active) naturalRef.current = { w: 1, h: 1 };
    };
    img.src = playmat;
    return () => {
      active = false;
      img.onload = null;
      img.onerror = null;
    };
  }, [playmat]);

  useEffect(() => {
    let disposed = false;
    let initSettled = false;
    let appDestroyed = false;
    const app = new Application();
    const destroyApp = () => {
      if (appDestroyed) return;
      appDestroyed = true;
      destroyPixiApp(app);
    };
    appRef.current = app;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        initSettled = true;
        if (appRef.current === app) appRef.current = null;
        destroyApp();
        return;
      }
      try {
        await app.init({
          canvas,
          width: previewWidth,
          height: previewHeight,
          backgroundColor: hexToNum(theme.gameTheme.canvas.background),
          antialias: true,
          autoDensity: true,
          resolution: Math.min(2, window.devicePixelRatio || 1),
          autoStart: false,
        });
      } catch (err) {
        initSettled = true;
        if (!disposed) console.error("[pixi] playmat preview init failed:", err);
        if (appRef.current === app) appRef.current = null;
        destroyApp();
        return;
      }
      initSettled = true;
      if (disposed || !app.renderer) {
        if (appRef.current === app) appRef.current = null;
        destroyApp();
        return;
      }
      app.stop();
      const render = () => {
        if (!disposed && app.renderer) app.render();
      };
      requestRenderRef.current = render;
      const felt = new Graphics();
      const layer = new PlaymatLayer(render);
      app.stage.addChild(felt, layer.container);
      layerRef.current = layer;
      feltRef.current = felt;
      setReady(true);
      render();
    })();
    return () => {
      disposed = true;
      requestRenderRef.current = () => undefined;
      layerRef.current?.destroy();
      layerRef.current = null;
      feltRef.current = null;
      if (appRef.current === app) appRef.current = null;
      if (initSettled) destroyApp();
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
    requestRenderRef.current();
  }, [ready, playmat, settings, previewWidth, previewHeight, theme]);

  useEffect(() => {
    const app = appRef.current;
    if (!ready || !app) return;
    setCardSpriteTheme(theme);
    setCardSpriteStyle(cardStyle);
    if (previewCards.length === 0 || !showSampleCards) {
      requestRenderRef.current();
      return;
    }
    let active = true;
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
    requestRenderRef.current();
    for (const card of previewCards) {
      void useScryfallStore
        .getState()
        .getCardTexture(
          asDeckCard(undefined, card),
          cardStyle === "realistic" ? "full" : "art",
          card.isTransformed ? 1 : 0,
        )
        .then(
          () => {
            if (active) requestRenderRef.current();
          },
          () => {
            if (active) requestRenderRef.current();
          },
        );
    }
    const manaCodes = new Set(previewCards.flatMap((card) => parseManaCost(card.manaCost)));
    for (const code of manaCodes) {
      void loadManaSymbolTexture(code).then(
        () => {
          if (active) requestRenderRef.current();
        },
        () => {
          if (active) requestRenderRef.current();
        },
      );
    }
    return () => {
      active = false;
      for (const sprite of sprites) safeDestroy(sprite);
      requestRenderRef.current();
    };
  }, [ready, previewCards, previewWidth, previewHeight, showSampleCards, theme, cardStyle]);

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
