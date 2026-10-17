import type { SyntheticEvent } from "react";

export function stopCardPreviewEvent(event: Event | SyntheticEvent): void {
  event.stopPropagation();
}

export function isCardPreviewTarget(target: EventTarget | null | undefined): boolean {
  return target instanceof Element && target.closest("[data-card-preview]") !== null;
}

export const CARD_PREVIEW_EVENT_HANDLERS = {
  onPointerDown: stopCardPreviewEvent,
  onPointerUp: stopCardPreviewEvent,
  onPointerMove: stopCardPreviewEvent,
  onPointerOver: stopCardPreviewEvent,
  onPointerOut: stopCardPreviewEvent,
  onPointerEnter: stopCardPreviewEvent,
  onPointerLeave: stopCardPreviewEvent,
  onPointerCancel: stopCardPreviewEvent,
  onMouseDown: stopCardPreviewEvent,
  onMouseUp: stopCardPreviewEvent,
  onMouseMove: stopCardPreviewEvent,
  onMouseOver: stopCardPreviewEvent,
  onMouseOut: stopCardPreviewEvent,
  onMouseEnter: stopCardPreviewEvent,
  onMouseLeave: stopCardPreviewEvent,
  onClick: stopCardPreviewEvent,
  onDoubleClick: stopCardPreviewEvent,
  onContextMenu: stopCardPreviewEvent,
  onTouchStart: stopCardPreviewEvent,
  onTouchMove: stopCardPreviewEvent,
  onTouchEnd: stopCardPreviewEvent,
  onTouchCancel: stopCardPreviewEvent,
  onWheel: stopCardPreviewEvent,
  onDragStart: stopCardPreviewEvent,
  onDrag: stopCardPreviewEvent,
  onDragEnd: stopCardPreviewEvent,
  onDragEnter: stopCardPreviewEvent,
  onDragLeave: stopCardPreviewEvent,
  onDragOver: stopCardPreviewEvent,
  onDrop: stopCardPreviewEvent,
};
