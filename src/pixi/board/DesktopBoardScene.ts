import type { Application } from "pixi.js";

import type { GameCanvasCallbacks } from "../types";
import { BoardScene } from "./BoardScene";
import { DesktopBoardScenePresentation } from "./DesktopBoardScenePresentation";

export class DesktopBoardScene extends BoardScene {
  constructor(app: Application, callbacks: GameCanvasCallbacks) {
    super(app, callbacks, new DesktopBoardScenePresentation());
  }
}
