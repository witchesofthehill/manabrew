import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Graphics } from "pixi.js";
import { toast } from "sonner";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImagePlus, Trash2 } from "lucide-react";
import { useDeckStore } from "@/stores/useDeckStore";
import { useTheme } from "@/hooks/useTheme";
import { useHandScale } from "@/hooks/useHandScale";
import { PlaymatLayer, DEFAULT_PLAYMAT_SETTINGS } from "@/pixi/board/PlaymatLayer";
import { computeBoardLayout } from "@/pixi/board/boardLayout";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { BG_ALPHA_IDLE, GAP, TABLE_RADIUS } from "@/pixi/constants";
import { hexToNum } from "@/pixi/colorUtils";
import { normalizeToWebp, ImageTooLargeError, PLAYMAT_IMAGE_BUDGET } from "@/lib/imageEncode";
import type { PlaymatSettings } from "@/types/manabrew";

const PREVIEW_WIDTH = 560;

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
  const [ready, setReady] = useState(false);

  function update(patch: Partial<PlaymatSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      setPlaymatSettings(next);
      return next;
    });
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
          <div className="flex justify-center">
            <canvas
              ref={canvasRef}
              style={{ width: PREVIEW_WIDTH, height: previewHeight }}
              className="max-w-full rounded-md border"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Opacity ({Math.round(settings.opacity * 100)}%)
              </Label>
              <input
                type="range"
                min={10}
                max={100}
                step={1}
                value={Math.round(settings.opacity * 100)}
                onChange={(e) => update({ opacity: Number(e.target.value) / 100 })}
                className="w-full accent-primary"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Cloth texture ({Math.round(settings.texture * 100)}%)
              </Label>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(settings.texture * 100)}
                onChange={(e) => update({ texture: Number(e.target.value) / 100 })}
                className="w-full accent-primary"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Border width ({settings.borderWidth}px)
              </Label>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={settings.borderWidth}
                onChange={(e) => update({ borderWidth: Number(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Border color</Label>
              <input
                type="color"
                value={settings.borderColor}
                onChange={(e) => update({ borderColor: e.target.value })}
                className="h-9 w-full cursor-pointer rounded-md border bg-background"
              />
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
          Replace image
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setPlaymat(undefined);
            onClose();
          }}
        >
          <Trash2 className="h-4 w-4" />
          Remove playmat
        </Button>
        <Button size="sm" className="ml-auto" onClick={onClose}>
          Done
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
