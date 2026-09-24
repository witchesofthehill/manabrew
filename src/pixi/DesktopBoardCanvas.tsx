import type { Application } from "pixi.js";

import { BoardCanvasSurface, type BoardCanvasProps } from "./BoardCanvas";
import { DESKTOP_BATTLEFIELD_LAYOUT } from "./board/DesktopBattlefieldLayout";
import type { BoardScene } from "./board/BoardScene";
import { DesktopBoardScene } from "./board/DesktopBoardScene";
import type { GameCanvasCallbacks } from "./types";

export type DesktopBoardCanvasProps = BoardCanvasProps;

function createDesktopBoardScene(app: Application, callbacks: GameCanvasCallbacks): BoardScene {
  return new DesktopBoardScene(app, callbacks);
}

export function DesktopBoardCanvas(props: DesktopBoardCanvasProps) {
  return (
    <BoardCanvasSurface
      {...props}
      layoutPolicy={DESKTOP_BATTLEFIELD_LAYOUT}
      createScene={createDesktopBoardScene}
    />
  );
}
