import { useState, type RefObject } from "react";

import type { BoardOverlayCanvasProps } from "@/pixi/BoardOverlayCanvas";
import { DesktopBoardCanvas, type DesktopBoardCanvasProps } from "@/pixi/DesktopBoardCanvas";
import { DesktopBoardOverlayCanvas } from "@/pixi/DesktopBoardOverlayCanvas";
import type { BoardScene } from "@/pixi/board/BoardScene";

interface DesktopGameSceneProps {
  battlefieldContainerRef?: RefObject<HTMLDivElement | null>;
  board: Omit<DesktopBoardCanvasProps, "onSceneChange">;
  overlay: Omit<BoardOverlayCanvasProps, "scene">;
}

export function DesktopGameScene({
  battlefieldContainerRef,
  board,
  overlay,
}: DesktopGameSceneProps) {
  const [scene, setScene] = useState<BoardScene | null>(null);
  return (
    <>
      <div ref={battlefieldContainerRef} className="absolute inset-0 z-10 overflow-hidden">
        <DesktopBoardCanvas {...board} onSceneChange={setScene} />
      </div>
      <div className="pointer-events-none absolute inset-0 z-[9000]">
        <DesktopBoardOverlayCanvas {...overlay} scene={scene} />
      </div>
    </>
  );
}
