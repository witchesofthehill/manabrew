import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { setCardSpriteTheme } from "@/pixi/CardSprite";
import { installPixiPatches } from "@/pixi/pixiPatches";
import { DialogCardPickerScene, type DialogCardPickerSceneProps } from "./DialogCardPickerScene";

installPixiPatches();

type DialogCardPickerCanvasProps = Omit<DialogCardPickerSceneProps, "ringColor" | "selectionColor">;

export function DialogCardPickerCanvas(props: DialogCardPickerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<DialogCardPickerScene | null>(null);
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  const latestProps = useRef<DialogCardPickerSceneProps>({
    ...props,
    ringColor: theme.gameTheme.cardRing,
    selectionColor: theme.appTheme.selection,
  });

  useLayoutEffect(() => {
    const nextProps = {
      ...props,
      ringColor: theme.gameTheme.cardRing,
      selectionColor: theme.appTheme.selection,
    };
    latestProps.current = nextProps;
    sceneRef.current?.update(nextProps);
  }, [props, theme.appTheme.selection, theme.gameTheme.cardRing]);

  useEffect(() => {
    setCardSpriteTheme(theme);
    sceneRef.current?.update(latestProps.current);
  }, [theme]);

  useEffect(() => {
    const scene = new DialogCardPickerScene(canvasRef.current!, latestProps.current, setError);
    sceneRef.current = scene;
    void scene.init();
    return () => {
      sceneRef.current = null;
      scene.destroy();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="sticky top-0 z-0 block w-full touch-pan-y"
        style={{ height: props.height }}
      />
      {error && (
        <p className="absolute inset-x-4 top-4 z-20 rounded-lg bg-card p-3 text-sm text-destructive">
          Card renderer unavailable: {error}
        </p>
      )}
    </>
  );
}
