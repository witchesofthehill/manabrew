import type { CSSProperties, ReactNode } from "react";

/**
 * The realistic-overlay P/T badge (bottom-right of a card), shared by every DOM
 * card renderer so it is the same fraction of the card on every surface (hover
 * preview, stack, modals, zones) instead of each hard-coding its own px size.
 *
 * Sized in container units (`cqw`) + `em`, so the card root must establish a
 * container (`@container`). `clamp` floors the font so small cards stay legible.
 * `baseValue` renders a struck-through pre-buff P/T above; `children` render
 * below (e.g. a damage marker).
 */
export function PtBadge({
  value,
  style,
  baseValue,
  children,
}: {
  value: string;
  style: CSSProperties;
  baseValue?: string | null;
  children?: ReactNode;
}) {
  return (
    <div
      className="absolute bottom-[5.5cqw] right-[5.5cqw] z-10 flex flex-col items-end gap-[0.2em] pointer-events-none"
      style={{ fontSize: "clamp(8px, 5.8cqw, 22px)" }}
    >
      {baseValue && (
        <span
          className="font-semibold rounded-[0.3em] bg-black/60 text-white/80 line-through leading-none"
          style={{ fontSize: "0.62em", padding: "0.12em 0.4em" }}
        >
          {baseValue}
        </span>
      )}
      <span
        className="font-bold rounded-[0.34em] shadow-md leading-none"
        style={{ padding: "0.22em 0.62em", ...style }}
      >
        {value}
      </span>
      {children}
    </div>
  );
}
