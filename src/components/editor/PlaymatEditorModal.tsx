import { useRef, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImagePlus, Trash2 } from "lucide-react";
import {
  DEFAULT_PLAYMAT_SETTINGS,
  clampBorderColor,
  clampPlaymatColor,
} from "@/pixi/board/PlaymatLayer";
import { normalizeToWebp, ImageTooLargeError, PLAYMAT_IMAGE_BUDGET } from "@/lib/imageEncode";
import { usePlaymatPreview } from "./usePlaymatPreview";
import { cn } from "@/lib/utils";
import type { PlaymatSettings } from "@/protocol/game";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface PlaymatEditorModalProps {
  onClose: () => void;
  title?: string;
  playmat: string | undefined;
  storedSettings: PlaymatSettings | undefined;
  setPlaymat: (dataUrl: string | undefined) => void;
  setPlaymatSettings: (settings: PlaymatSettings | undefined) => void;
}

export function PlaymatEditorModal({
  onClose,
  title = "Customize Playmat",
  playmat,
  storedSettings,
  setPlaymat,
  setPlaymatSettings,
}: PlaymatEditorModalProps) {
  const [settings, setSettings] = useState<Required<PlaymatSettings>>({
    ...DEFAULT_PLAYMAT_SETTINGS,
    ...(storedSettings ?? {}),
  });
  const [borderHex, setBorderHex] = useState(settings.borderColor);
  const [prevBorder, setPrevBorder] = useState(settings.borderColor);
  if (prevBorder !== settings.borderColor) {
    setPrevBorder(settings.borderColor);
    setBorderHex(settings.borderColor);
  }
  const [bgHex, setBgHex] = useState(settings.color);
  const [prevBg, setPrevBg] = useState(settings.color);
  if (prevBg !== settings.color) {
    setPrevBg(settings.color);
    setBgHex(settings.color);
  }
  const fileInputRef = useRef<HTMLInputElement>(null);

  function update(patch: Partial<PlaymatSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      setPlaymatSettings(next);
      return next;
    });
  }

  const { canvasRef, previewWidth, previewHeight, onPointerDown } = usePlaymatPreview({
    playmat,
    settings,
    onOffsetChange: (offset) => update(offset),
  });

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

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <Modal.Header>{title}</Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-1">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              style={{ width: previewWidth, height: previewHeight }}
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
                  onChange={(e) => update({ color: clampPlaymatColor(e.target.value) })}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5"
                />
                <input
                  value={bgHex}
                  placeholder="none"
                  onChange={(e) => {
                    setBgHex(e.target.value);
                    if (HEX_RE.test(e.target.value))
                      update({ color: clampPlaymatColor(e.target.value) });
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
