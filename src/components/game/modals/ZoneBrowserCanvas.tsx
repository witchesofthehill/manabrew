import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTheme } from "@/hooks/useTheme";
import { setCardSpriteTheme } from "@/pixi/CardSprite";
import { installPixiPatches } from "@/pixi/pixiPatches";
import { ZoneBrowserScene, type ZoneBrowserSceneProps } from "@/pixi/zones/ZoneBrowserScene";

installPixiPatches();

export interface ZoneBrowserCanvasHandle {
  toggleActiveView: () => void;
  toggleActiveFace: () => void;
}

type ZoneBrowserCanvasProps = Omit<ZoneBrowserSceneProps, "width" | "height"> & {
  actionsRef: RefObject<ZoneBrowserCanvasHandle | null>;
};

export function ZoneBrowserCanvas({ actionsRef, ...props }: ZoneBrowserCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ZoneBrowserScene | null>(null);
  const theme = useTheme();
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [error, setError] = useState<string | null>(null);
  const latestProps = useRef<ZoneBrowserSceneProps>({ ...props, ...viewport });

  useLayoutEffect(() => {
    const next = { ...props, ...viewport };
    latestProps.current = next;
    sceneRef.current?.update(next);
  }, [props, viewport]);

  useEffect(() => {
    actionsRef.current = {
      toggleActiveView: () => sceneRef.current?.toggleActiveView(),
      toggleActiveFace: () => sceneRef.current?.toggleActiveFace(),
    };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef]);

  useEffect(() => {
    const host = hostRef.current!;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      setViewport({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setCardSpriteTheme(theme);
    sceneRef.current?.update(latestProps.current);
  }, [theme]);

  useEffect(() => {
    const scene = new ZoneBrowserScene(canvasRef.current!, latestProps.current, setError);
    sceneRef.current = scene;
    void scene.init();
    return () => {
      sceneRef.current = null;
      scene.destroy();
    };
  }, []);

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      {error && (
        <p className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-3 text-sm text-destructive shadow-xl">
          Card renderer unavailable: {error}
        </p>
      )}
    </div>
  );
}
