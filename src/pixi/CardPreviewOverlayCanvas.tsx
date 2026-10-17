import {
  BoardOverlayCanvasSurface,
  type BoardOverlayCanvasProps,
  type BoardOverlayPreviewSpec,
} from "@/pixi/BoardOverlayCanvas";

export interface CardPreviewOverlayCanvasProps extends Pick<
  BoardOverlayCanvasProps,
  | "className"
  | "externalPreviewActive"
  | "onPreviewPointerEnter"
  | "onPreviewPointerLeave"
  | "onSelectPreviewAction"
  | "onDismissPreview"
  | "onFlipPreview"
  | "onTogglePreviewView"
> {
  previewSpec: BoardOverlayPreviewSpec | null;
}

export function CardPreviewOverlayCanvas(props: CardPreviewOverlayCanvasProps) {
  return <BoardOverlayCanvasSurface {...props} />;
}
