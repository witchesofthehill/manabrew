import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { clampOffset, coverScale, renderCroppedAvatar } from "@/lib/avatarCrop";
import { cn } from "@/lib/utils";

const VIEWPORT = 280;
const OUT_PX = 512;
const MAX_ZOOM = 4;

interface AvatarCropDialogProps {
  file: Blob | null;
  onCancel: () => void;
  onConfirm: (cropped: Blob) => Promise<void>;
}

export function AvatarCropDialog({ file, onCancel, onConfirm }: AvatarCropDialogProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setImageSize(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const minScale = imageSize ? coverScale(imageSize.width, imageSize.height, VIEWPORT) : 1;
  const scale = minScale * zoom;

  function clampAll(x: number, y: number, nextScale: number) {
    if (!imageSize) return { x: 0, y: 0 };
    return {
      x: clampOffset(x, nextScale, imageSize.width, VIEWPORT),
      y: clampOffset(y, nextScale, imageSize.height, VIEWPORT),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.movementX ?? e.clientX - drag.startX;
    const dy = e.movementY ?? e.clientY - drag.startY;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    setOffset((prev) => {
      const next = clampAll(prev.x + dx, prev.y + dy, scale);
      return next;
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  function onZoomChange(value: number) {
    const nextScale = minScale * value;
    setZoom(value);
    setOffset((prev) => clampAll(prev.x, prev.y, nextScale));
  }

  async function confirm() {
    if (!file || saving) return;
    setSaving(true);
    try {
      const cropped = await renderCroppedAvatar(
        file,
        { scale, offsetX: offset.x, offsetY: offset.y },
        VIEWPORT,
        OUT_PX,
      );
      await onConfirm(cropped);
    } finally {
      setSaving(false);
    }
  }

  const displayedWidth = imageSize ? imageSize.width * scale : 0;
  const displayedHeight = imageSize ? imageSize.height * scale : 0;

  return (
    <Dialog open={file != null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Crop avatar</DialogTitle>
        <DialogDescription>Drag to position, use the slider to zoom.</DialogDescription>

        <div className="flex flex-col items-center gap-4">
          <div
            className="relative touch-none select-none overflow-hidden rounded-md bg-muted/40"
            style={{ width: VIEWPORT, height: VIEWPORT }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {imageUrl && (
              <img
                src={imageUrl}
                alt=""
                draggable={false}
                onLoad={(e) =>
                  setImageSize({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  })
                }
                className={cn("absolute max-w-none", !imageSize && "invisible")}
                style={
                  imageSize
                    ? {
                        width: displayedWidth,
                        height: displayedHeight,
                        left: VIEWPORT / 2 + offset.x - displayedWidth / 2,
                        top: VIEWPORT / 2 + offset.y - displayedHeight / 2,
                      }
                    : undefined
                }
              />
            )}
            <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_color-mix(in_srgb,var(--color-background)_72%,transparent)]" />
            <div className="pointer-events-none absolute inset-0 rounded-full border border-border" />
          </div>

          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => onZoomChange(Number(e.target.value))}
            aria-label="Zoom"
            className="w-full accent-primary"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={!imageSize || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
