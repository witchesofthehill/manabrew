import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ImagePlus,
  Info,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  DEFAULT_PLAYMAT_SETTINGS,
  PLAYMAT_ZOOM_MAX,
  PLAYMAT_BLUR_MAX,
  PLAYMAT_BRIGHTNESS_MIN,
  PLAYMAT_BRIGHTNESS_MAX,
  clampBorderColor,
  clampPlaymatColor,
} from "@/pixi/board/PlaymatLayer";
import { normalizeToWebp, ImageTooLargeError, PLAYMAT_IMAGE_BUDGET } from "@/lib/imageEncode";
import { usePlaymatPreview } from "./usePlaymatPreview";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PlaymatSettings } from "@/protocol/game";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Built-in playmat presets — any image dropped in `images/playmats/` shows up
 *  here automatically (resolved from the Vite project root). */
const PLAYMAT_PRESETS: { url: string; name: string }[] = Object.entries(
  import.meta.glob<string>("/images/playmats/*.{png,jpg,jpeg,webp}", {
    eager: true,
    query: "?url",
    import: "default",
  }),
).map(([path, url]) => {
  const file =
    path
      .split("/")
      .pop()
      ?.replace(/\.[a-z]+$/i, "") ?? "playmat";
  const name = file.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { url, name };
});

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
  const [showSampleCards, setShowSampleCards] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  function update(patch: Partial<PlaymatSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      setPlaymatSettings(next);
      return next;
    });
  }

  const isDefaultSettings = (
    Object.keys(DEFAULT_PLAYMAT_SETTINGS) as (keyof PlaymatSettings)[]
  ).every((k) => settings[k] === DEFAULT_PLAYMAT_SETTINGS[k]);

  function resetSettings() {
    setSettings({ ...DEFAULT_PLAYMAT_SETTINGS });
    setPlaymatSettings(undefined);
  }

  const { canvasRef, previewRef, previewWidth, previewHeight } = usePlaymatPreview({
    playmat,
    settings,
    onOffsetChange: (offset) => update(offset),
    onZoomChange: (zoom) => update({ zoom }),
    showSampleCards,
  });

  async function setPlaymatFromBlob(blob: Blob) {
    setBusy(true);
    try {
      setPlaymat(await normalizeToWebp(blob, PLAYMAT_IMAGE_BUDGET));
    } catch (err) {
      toast.error(
        err instanceof ImageTooLargeError ? err.message : "Couldn't use that image as a playmat",
      );
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void setPlaymatFromBlob(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (file) void setPlaymatFromBlob(file);
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void setPlaymatFromBlob(file);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyPreset(url: string) {
    setBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setPlaymat(await normalizeToWebp(blob, PLAYMAT_IMAGE_BUDGET));
      update({ fit: "cover" });
    } catch {
      toast.error("Couldn't load that preset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-6xl">
      <Modal.Header>{title}</Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          <div
            ref={previewRef}
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            className="flex flex-col items-center gap-1"
          >
            <div className="relative">
              <canvas
                ref={canvasRef}
                style={{ width: previewWidth, height: previewHeight }}
                className={cn(
                  "max-w-full touch-none rounded-md border",
                  settings.fit === "cover" && "cursor-grab active:cursor-grabbing",
                )}
              />
              {busy && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-overlay/40">
                  <Loader2 className="size-7 animate-spin text-primary-foreground" />
                </div>
              )}
              {dragActive && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-overlay/50 text-sm font-medium text-primary-foreground">
                  Drop image to use as playmat
                </div>
              )}
            </div>
            {settings.fit === "cover" && (
              <p className="text-xs text-muted-foreground">
                Drag to reposition · scroll or pinch to zoom · drop or paste an image
              </p>
            )}
            <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={showSampleCards}
                onCheckedChange={(v) => setShowSampleCards(v === true)}
              />
              Show sample cards
            </label>
          </div>

          <section className="space-y-2.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Background image
            </Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPick}
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              {playmat ? "Replace image" : "Upload image"}
            </Button>
            {PLAYMAT_PRESETS.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {PLAYMAT_PRESETS.map((p) => (
                  <button
                    key={p.url}
                    type="button"
                    onClick={() => void applyPreset(p.url)}
                    title={p.name}
                    className="h-12 w-[5.5rem] shrink-0 overflow-hidden rounded-md border transition-[transform,border-color] hover:scale-[1.04] hover:border-primary"
                  >
                    <img
                      src={p.url}
                      alt={p.name}
                      draggable={false}
                      className="size-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </section>

          {playmat && (
            <section className="space-y-2.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Image
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Playmat image tips"
                    >
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    The playmat fills a wide, landscape area (roughly 5:2). For a crisp result use a
                    landscape image at least ~1600px wide — up to 4096px on the long edge and
                    3&nbsp;MB are kept. Use <strong>Cover</strong>, then drag and scroll to zoom and
                    frame it.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Placement</Label>
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
              {settings.fit === "cover" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Vertical framing
                  </Label>
                  <div className="inline-flex w-full rounded-lg border bg-muted/40 p-1">
                    {(
                      [
                        ["Top", 0, AlignVerticalJustifyStart],
                        ["Center", 0.5, AlignVerticalJustifyCenter],
                        ["Bottom", 1, AlignVerticalJustifyEnd],
                      ] as const
                    ).map(([label, oy, Icon]) => (
                      <button
                        key={label}
                        type="button"
                        title={label}
                        aria-label={label}
                        onClick={() => update({ offsetY: oy })}
                        className={cn(
                          "flex flex-1 items-center justify-center rounded-md px-3 py-1.5 transition-colors",
                          Math.abs(settings.offsetY - oy) < 0.001
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="size-4" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {settings.fit === "cover" && (
                  <SliderControl
                    label="Zoom"
                    value={`${Math.round(settings.zoom * 100)}%`}
                    min={100}
                    max={Math.round(PLAYMAT_ZOOM_MAX * 100)}
                    current={Math.round(settings.zoom * 100)}
                    onChange={(v) => update({ zoom: v / 100 })}
                  />
                )}
                <SliderControl
                  label="Opacity"
                  value={`${Math.round(settings.opacity * 100)}%`}
                  min={10}
                  max={100}
                  current={Math.round(settings.opacity * 100)}
                  onChange={(v) => update({ opacity: v / 100 })}
                />
                <SliderControl
                  label="Blur"
                  value={`${Math.round(settings.blur)}px`}
                  min={0}
                  max={PLAYMAT_BLUR_MAX}
                  current={Math.round(settings.blur)}
                  onChange={(v) => update({ blur: v })}
                />
                <SliderControl
                  label="Brightness"
                  value={`${Math.round(settings.brightness * 100)}%`}
                  min={Math.round(PLAYMAT_BRIGHTNESS_MIN * 100)}
                  max={Math.round(PLAYMAT_BRIGHTNESS_MAX * 100)}
                  current={Math.round(settings.brightness * 100)}
                  onChange={(v) => update({ brightness: v / 100 })}
                />
              </div>
            </section>
          )}

          <section className="space-y-2.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Table
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <SliderControl
                label="Cloth texture"
                value={`${Math.round(settings.texture * 100)}%`}
                min={0}
                max={100}
                current={Math.round(settings.texture * 100)}
                onChange={(v) => update({ texture: v / 100 })}
              />
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
          </section>

          <section className="space-y-2.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Border
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <SliderControl
                label="Width"
                value={`${settings.borderWidth}px`}
                min={0}
                max={40}
                current={settings.borderWidth}
                onChange={(v) => update({ borderWidth: v })}
              />
              <div className="space-y-2 rounded-lg border bg-card/40 p-3">
                <Label className="text-xs font-medium">Color</Label>
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
            </div>
          </section>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetSettings}
          disabled={isDefaultSettings}
          title="Reset all adjustments to their defaults"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
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
  const pct = max > min ? ((current - min) / (max - min)) * 100 : 0;
  return (
    <div className="group space-y-2.5 rounded-lg border bg-card/40 p-3 transition-colors hover:border-primary/40">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{label}</Label>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-primary">
          {value}
        </span>
      </div>
      <div className="relative flex h-4 items-center">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 rounded-full border-2 border-background bg-primary shadow-sm transition-transform group-hover:scale-110"
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={current}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}
