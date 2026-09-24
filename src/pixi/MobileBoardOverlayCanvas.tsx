import type { Application } from "pixi.js";

import { BoardOverlayCanvasSurface, type BoardOverlayCanvasProps } from "./BoardOverlayCanvas";
import { MobilePromptLayer } from "./prompts/MobilePromptLayer";
import type { PromptLayer } from "./prompts/PromptLayer";
import type { PromptLayerCallbacks } from "./prompts/prompt.types";

function createMobilePromptLayer(app: Application, callbacks: PromptLayerCallbacks): PromptLayer {
  return new MobilePromptLayer(app, callbacks);
}

export function MobileBoardOverlayCanvas(props: BoardOverlayCanvasProps) {
  return <BoardOverlayCanvasSurface {...props} createPromptLayer={createMobilePromptLayer} />;
}
