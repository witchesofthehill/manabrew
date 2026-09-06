import { useEffect, useRef } from "react";
import type { ArenaSceneProps } from "@/three/arena.types";
import { createArenaScene } from "@/three/createArenaScene";
export function ArenaScene(props: ArenaSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  useEffect(() => {
    live.current = props;
  }, [props]);
  useEffect(() => createArenaScene(host.current!, live), [props.colors]);
  return <div ref={host} className="arena-canvas" />;
}
