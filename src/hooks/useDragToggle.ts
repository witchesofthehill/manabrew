import { useRef, useCallback } from "react";

const DRAG_THRESHOLD = 30;

export function useDragToggle(
  onExpand: () => void,
  onCollapse: () => void,
  expandDirection: "left" | "right",
) {
  const dragRef = useRef<{ startX: number; moved: boolean } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      dragRef.current = { startX: e.clientX, moved: false };

      const handleMouseMove = (me: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = me.clientX - dragRef.current.startX;
        if (Math.abs(dx) < DRAG_THRESHOLD) return;

        dragRef.current.moved = true;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        dragRef.current = null;

        const isExpandDrag = expandDirection === "right" ? dx > 0 : dx < 0;
        if (isExpandDrag) onExpand();
        else onCollapse();
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        dragRef.current = null;
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onExpand, onCollapse, expandDirection],
  );

  return onMouseDown;
}
