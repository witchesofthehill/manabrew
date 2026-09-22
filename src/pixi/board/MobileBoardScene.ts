import type { Application } from "pixi.js";

import type { GameCanvasCallbacks } from "../types";
import type { BlockingRect } from "./types";
import { BoardScene } from "./BoardScene";
import { MobileBoardScenePresentation } from "./MobileBoardScenePresentation";

export class MobileBoardScene extends BoardScene {
  constructor(app: Application, callbacks: GameCanvasCallbacks) {
    super(app, callbacks, new MobileBoardScenePresentation());
  }

  setMobileHandOpen(open: boolean): void {
    super.setMobileHandOpen(open);
  }
  setHandPeek(active: boolean): void {
    super.setHandPeek(active);
  }

  setMobileHandControlBlocker(blocker: BlockingRect | null): void {
    super.setMobileHandControlBlocker(blocker);
  }
}
