import { useCallback } from "react";
import type { Application } from "pixi.js";

import { BoardCanvasSurface, type BoardCanvasProps } from "./BoardCanvas";
import { MOBILE_BATTLEFIELD_LAYOUT } from "./board/MobileBattlefieldLayout";
import type { BoardScene } from "./board/BoardScene";
import { MobileBoardScene } from "./board/MobileBoardScene";
import type { GameCanvasCallbacks } from "./types";

export interface MobileBoardCanvasProps extends BoardCanvasProps {
  mobileHandOpen?: boolean;
  mobileHandPeek?: boolean;
  mobileHandControlBounds?: DOMRect | null;
}

function createMobileBoardScene(
  app: Application,
  callbacks: GameCanvasCallbacks,
): MobileBoardScene {
  return new MobileBoardScene(app, callbacks);
}

export function MobileBoardCanvas({
  mobileHandOpen = false,
  mobileHandPeek = false,
  mobileHandControlBounds,
  ...props
}: MobileBoardCanvasProps) {
  const syncScenePresentation = useCallback(
    (scene: BoardScene, canvas: HTMLCanvasElement) => {
      const mobileScene = scene as MobileBoardScene;
      mobileScene.setMobileHandOpen(mobileHandOpen);
      mobileScene.setHandPeek(mobileHandPeek);
      const canvasBounds = canvas.getBoundingClientRect();
      mobileScene.setMobileHandControlBlocker(
        !mobileHandOpen && mobileHandControlBounds
          ? {
              x: mobileHandControlBounds.left - canvasBounds.left,
              y: mobileHandControlBounds.top - canvasBounds.top,
              width: mobileHandControlBounds.width,
              height: mobileHandControlBounds.height,
            }
          : null,
      );
    },
    [mobileHandControlBounds, mobileHandOpen, mobileHandPeek],
  );

  return (
    <BoardCanvasSurface
      {...props}
      layoutPolicy={MOBILE_BATTLEFIELD_LAYOUT}
      createScene={createMobileBoardScene}
      syncScenePresentation={syncScenePresentation}
    />
  );
}
