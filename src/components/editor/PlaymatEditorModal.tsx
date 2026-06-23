import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Graphics, Sprite, Texture } from "pixi.js";
import { toast } from "sonner";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImagePlus, Trash2 } from "lucide-react";
import { useDeckStore } from "@/stores/useDeckStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useTheme } from "@/hooks/useTheme";
import { useHandScale } from "@/hooks/useHandScale";
import {
  PlaymatLayer,
  DEFAULT_PLAYMAT_SETTINGS,
  clampBorderColor,
} from "@/pixi/board/PlaymatLayer";
import { computeBoardLayout } from "@/pixi/board/boardLayout";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { BG_ALPHA_IDLE, GAP, TABLE_RADIUS } from "@/pixi/constants";
import { hexToNum } from "@/pixi/colorUtils";
import { normalizeToWebp, ImageTooLargeError, PLAYMAT_IMAGE_BUDGET } from "@/lib/imageEncode";
import { cn } from "@/lib/utils";
import type { DeckCard, PlaymatSettings } from "@/types/manabrew";

const PREVIEW_WIDTH = 560;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// A few real cards shown over the preview so the mat reads as the background it is.
const PREVIEW_CARD_NAMES = ["Serra Angel", "Tarmogoyf", "Steam Vents"];
function sampleDeckCard(name: string): DeckCard {
  return { name, setCode: "", cardNumber: "" } as unknown as DeckCard;
}

/** The local player's battlefield felt aspect ratio, mirroring GameBoard's
 *  region + hand-reserve math, so the preview is shaped like the real board. */
function useBattlefieldAspect(): number {
  const vScale = useHandScale();
  return useMemo(() => {
    const layout = computeBoardLayout(window.innerWidth, window.innerHeight, 1, "row");
    const handReserve = Math.round(0.55 * HAND_CARD_BASE.cardH * vScale) + GAP;
    const feltHeight = Math.max(1, layout.self.height - handReserve);
    return layout.self.width / feltHeight;
  }, [vScale]);
}

export function PlaymatEditorModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const playmat = useDeckStore((s) => s.currentDeck.playmat);
  const storedSettings = useDeckStore((s) => s.currentDeck.playmatSettings);
  const setPlaymat = useDeckStore((s) => s.setPlaymat);
  const setPlaymatSettings = useDeckStore((s) => s.setPlaymatSettings);

  const [settings, setSettings] = useState<Required<PlaymatSettings>>({
    ...DEFAULT_PLAYMAT_SETTINGS,
    ...(storedSettings ?? {}),
  });

  const aspect = useBattlefieldAspect();
  const previewHeight = Math.round(PREVIEW_WIDTH / aspect);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const layerRef = useRef<PlaymatLayer | null>(null);
  const feltRef = useRef<Graphics | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const naturalRef = useRef<{ w: number; h: number }>({ w: 1, h: 1 });
  const [ready, setReady] = useState(false);
  const [borderHex, setBorderHex] = useState(settings.borderColor);
  useEffect(() => setBorderHex(settings.borderColor), [settings.borderColor]);
  const [bgHex, setBgHex] = useState(settings.color);
  useEffect(() => setBgHex(settings.color), [settings.color]);

  useEffect(() => {
    if (!playmat) return;
    const img = new Image();
    img.onload = () => {
      naturalRef.current = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
    };
    img.src = playmat;
  }, [playmat]);

  function update(patch: Partial<PlaymatSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      setPlaymatSettings(next);
      return next;
    });
  }

  // Drag the cover image to reposition its focal point. Offsets are normalized,
  // so the same `offsetX/offsetY` reproduce exactly on the battlefield.
  function onPreviewPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
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
      update({
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

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setPlaymat(await normalizeToWebp(file, PLAYMAT_IMAGE_BUDGET));
    } catch (err) {
      toast.error(
        err instanceof ImageTooLargeError ? err.message : "Couldn't use that image as a playmat",
      );
    }
  }

  // Init the Pixi preview once; tear it down on unmount.
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

      const cardH = previewHeight * 0.62;
      const cardW = cardH * 0.716;
      const gap = cardW * 0.16;
      const total = PREVIEW_CARD_NAMES.length * cardW + (PREVIEW_CARD_NAMES.length - 1) * gap;
      let cardX = (PREVIEW_WIDTH - total) / 2 + cardW / 2;
      const cardY = previewHeight * 0.56;
      for (const name of PREVIEW_CARD_NAMES) {
        const tex = await useScryfallStore
          .getState()
          .getCardTexture(sampleDeckCard(name), "full", 0)
          .catch(() => Texture.EMPTY);
        if (disposed) return;
        if (tex !== Texture.EMPTY) {
          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5);
          sprite.eventMode = "none";
          sprite.scale.set(cardH / (tex.height || 1040));
          sprite.x = cardX;
          sprite.y = cardY;
          app.stage.addChild(sprite);
        }
        cardX += cardW + gap;
      }
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
    // Built once; live updates flow through the settings/image effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push image, settings, and geometry to the preview whenever they change.
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

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <Modal.Header>Customize Playmat</Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-1">
            <canvas
              ref={canvasRef}
              onPointerDown={onPreviewPointerDown}
              style={{ width: PREVIEW_WIDTH, height: previewHeight }}
              className={cn(
                "max-w-full touch-none rounded-md border",
                settings.fit === "cover" && "cursor-grab active:cursor-grabbing",
              )}
            />
            {settings.fit === "cover" && (
              <p className="text-xs text-muted-foreground">Drag the image to reposition</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Image placement</Label>
            <div className="inline-flex w-full rounded-lg border bg-muted/40 p-1">
              {(["cover", "fit", "stretch"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => update({ fit: mode })}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    settings.fit === mode
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <SliderControl
              label="Opacity"
              value={`${Math.round(settings.opacity * 100)}%`}
              min={10}
              max={100}
              current={Math.round(settings.opacity * 100)}
              onChange={(v) => update({ opacity: v / 100 })}
            />
            <SliderControl
              label="Cloth texture"
              value={`${Math.round(settings.texture * 100)}%`}
              min={0}
              max={100}
              current={Math.round(settings.texture * 100)}
              onChange={(v) => update({ texture: v / 100 })}
            />
            <SliderControl
              label="Border width"
              value={`${settings.borderWidth}px`}
              min={0}
              max={40}
              current={settings.borderWidth}
              onChange={(v) => update({ borderWidth: v })}
            />
            <div className="rounded-lg border bg-card/40 p-3 space-y-2">
              <Label className="text-xs font-medium">Border color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.borderColor}
                  onChange={(e) => update({ borderColor: clampBorderColor(e.target.value) })}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5"
                />
                <input
                  value={borderHex}
                  onChange={(e) => {
                    setBorderHex(e.target.value);
                    if (HEX_RE.test(e.target.value))
                      update({ borderColor: clampBorderColor(e.target.value) });
                  }}
                  onBlur={() => setBorderHex(settings.borderColor)}
                  spellCheck={false}
                  autoComplete="off"
                  className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 font-mono text-xs uppercase"
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border bg-card/40 p-3">
              <Label className="text-xs font-medium">Background color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.color || "#000000"}
                  onChange={(e) => update({ color: e.target.value })}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5"
                />
                <input
                  value={bgHex}
                  placeholder="none"
                  onChange={(e) => {
                    setBgHex(e.target.value);
                    if (HEX_RE.test(e.target.value)) update({ color: e.target.value });
                  }}
                  onBlur={() => setBgHex(settings.color)}
                  spellCheck={false}
                  autoComplete="off"
                  className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 font-mono text-xs uppercase"
                />
                {settings.color && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 px-2"
                    onClick={() => update({ color: "" })}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPick}
        />
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <ImagePlus className="h-4 w-4" />
          {playmat ? "Replace image" : "Upload image"}
        </Button>
        {(playmat || settings.color) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPlaymat(undefined);
              update({ color: "" });
              onClose();
            }}
          >
            <Trash2 className="h-4 w-4" />
            Remove playmat
          </Button>
        )}
        <Button size="sm" className="ml-auto" onClick={onClose}>
          Done
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  current,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  current: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-card/40 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{label}</Label>
        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}
