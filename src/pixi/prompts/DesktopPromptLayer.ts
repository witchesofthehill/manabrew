import type { Application } from "pixi.js";

import { PromptLayer } from "./PromptLayer";
import { DesktopPromptLayerPresentation } from "./DesktopPromptLayerPresentation";
import type { PromptLayerCallbacks } from "./prompt.types";

export class DesktopPromptLayer extends PromptLayer {
  constructor(app: Application, callbacks: PromptLayerCallbacks = {}) {
    super(app, new DesktopPromptLayerPresentation(), callbacks);
  }
}
