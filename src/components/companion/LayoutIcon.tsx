import { cn } from "@/lib/utils";
import type { CompanionLayout } from "@/stores/useCompanionStore.types";

interface LayoutIconProps {
  layout: CompanionLayout;
  className?: string;
}

export function LayoutIcon({ layout, className }: LayoutIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      {SHAPES[layout]}
    </svg>
  );
}

const RX = 1.4;

const SHAPES: Record<CompanionLayout, React.ReactNode> = {
  "1v1": (
    <>
      <rect x="2.5" y="2.5" width="19" height="8.5" rx={RX} transform="rotate(180 12 6.75)" />
      <rect x="2.5" y="13" width="19" height="8.5" rx={RX} />
    </>
  ),
  "two-side": (
    <>
      <rect x="2.5" y="2.5" width="8.5" height="19" rx={RX} />
      <rect x="13" y="2.5" width="8.5" height="19" rx={RX} />
    </>
  ),
  "two-across": (
    <>
      <rect x="2.5" y="2.5" width="8.5" height="19" rx={RX} />
      <circle cx="4.4" cy="12" r="0.9" fill="currentColor" />
      <rect x="13" y="2.5" width="8.5" height="19" rx={RX} />
      <circle cx="19.6" cy="12" r="0.9" fill="currentColor" />
    </>
  ),
  "three-wedge": (
    <>
      <rect x="2.5" y="2.5" width="19" height="8.5" rx={RX} transform="rotate(180 12 6.75)" />
      <rect x="2.5" y="13" width="8.5" height="8.5" rx={RX} />
      <rect x="13" y="13" width="8.5" height="8.5" rx={RX} />
    </>
  ),
  "three-sides": (
    <>
      <rect x="2.5" y="2.5" width="19" height="7.5" rx={RX} transform="rotate(180 12 6.25)" />
      <rect x="2.5" y="12" width="8.5" height="9.5" rx={RX} />
      <circle cx="4.4" cy="16.75" r="0.9" fill="currentColor" />
      <rect x="13" y="12" width="8.5" height="9.5" rx={RX} />
      <circle cx="19.6" cy="16.75" r="0.9" fill="currentColor" />
    </>
  ),
  "pinwheel-3": (
    <>
      <rect x="2.5" y="2.5" width="19" height="9.5" rx={RX} transform="rotate(180 12 7.25)" />
      <rect x="2.5" y="13.5" width="8.5" height="8" rx={RX} />
      <rect x="13" y="13.5" width="8.5" height="8" rx={RX} />
      <circle cx="12" cy="12.7" r="0.8" fill="currentColor" />
    </>
  ),
  quad: (
    <>
      <rect x="2.5" y="2.5" width="8.5" height="8.5" rx={RX} transform="rotate(180 6.75 6.75)" />
      <rect x="13" y="2.5" width="8.5" height="8.5" rx={RX} transform="rotate(180 17.25 6.75)" />
      <rect x="2.5" y="13" width="8.5" height="8.5" rx={RX} />
      <rect x="13" y="13" width="8.5" height="8.5" rx={RX} />
    </>
  ),
  "four-sides": (
    <>
      <rect x="2.5" y="2.5" width="19" height="5.5" rx={RX} transform="rotate(180 12 5.25)" />
      <rect x="2.5" y="9.5" width="8.5" height="5" rx={RX} transform="rotate(90 6.75 12)" />
      <rect x="13" y="9.5" width="8.5" height="5" rx={RX} transform="rotate(-90 17.25 12)" />
      <rect x="2.5" y="16" width="19" height="5.5" rx={RX} />
    </>
  ),
  "five-radial": (
    <>
      <rect x="2.5" y="2.5" width="19" height="5.5" rx={RX} transform="rotate(180 12 5.25)" />
      <rect x="2.5" y="9.5" width="8.5" height="5" rx={RX} transform="rotate(90 6.75 12)" />
      <rect x="13" y="9.5" width="8.5" height="5" rx={RX} transform="rotate(-90 17.25 12)" />
      <rect x="2.5" y="16" width="8.5" height="5.5" rx={RX} />
      <rect x="13" y="16" width="8.5" height="5.5" rx={RX} />
    </>
  ),
  "five-rows": (
    <>
      <rect x="2.5" y="2.5" width="9" height="8.5" rx={RX} transform="rotate(180 7 6.75)" />
      <rect x="12.5" y="2.5" width="9" height="8.5" rx={RX} transform="rotate(180 17 6.75)" />
      <rect x="2.5" y="13" width="5.5" height="8.5" rx={RX} />
      <rect x="9.25" y="13" width="5.5" height="8.5" rx={RX} />
      <rect x="16" y="13" width="5.5" height="8.5" rx={RX} />
    </>
  ),
  "six-grid": (
    <>
      <rect x="2.5" y="2.5" width="5.5" height="8.5" rx={RX} transform="rotate(180 5.25 6.75)" />
      <rect x="9.25" y="2.5" width="5.5" height="8.5" rx={RX} transform="rotate(180 12 6.75)" />
      <rect x="16" y="2.5" width="5.5" height="8.5" rx={RX} transform="rotate(180 18.75 6.75)" />
      <rect x="2.5" y="13" width="5.5" height="8.5" rx={RX} />
      <rect x="9.25" y="13" width="5.5" height="8.5" rx={RX} />
      <rect x="16" y="13" width="5.5" height="8.5" rx={RX} />
    </>
  ),
  "six-sides": (
    <>
      <rect x="2.5" y="2.5" width="8.5" height="5.5" rx={RX} />
      <circle cx="4.4" cy="5.25" r="0.8" fill="currentColor" />
      <rect x="2.5" y="9.25" width="8.5" height="5.5" rx={RX} />
      <circle cx="4.4" cy="12" r="0.8" fill="currentColor" />
      <rect x="2.5" y="16" width="8.5" height="5.5" rx={RX} />
      <circle cx="4.4" cy="18.75" r="0.8" fill="currentColor" />
      <rect x="13" y="2.5" width="8.5" height="5.5" rx={RX} />
      <circle cx="19.6" cy="5.25" r="0.8" fill="currentColor" />
      <rect x="13" y="9.25" width="8.5" height="5.5" rx={RX} />
      <circle cx="19.6" cy="12" r="0.8" fill="currentColor" />
      <rect x="13" y="16" width="8.5" height="5.5" rx={RX} />
      <circle cx="19.6" cy="18.75" r="0.8" fill="currentColor" />
    </>
  ),
  "pinwheel-6": (
    <>
      <rect x="2.5" y="2.5" width="8.5" height="5.5" rx={RX} transform="rotate(180 6.75 5.25)" />
      <rect x="13" y="2.5" width="8.5" height="5.5" rx={RX} transform="rotate(180 17.25 5.25)" />
      <rect x="2.5" y="9.5" width="8.5" height="5" rx={RX} transform="rotate(90 6.75 12)" />
      <rect x="13" y="9.5" width="8.5" height="5" rx={RX} transform="rotate(-90 17.25 12)" />
      <rect x="2.5" y="16" width="8.5" height="5.5" rx={RX} />
      <rect x="13" y="16" width="8.5" height="5.5" rx={RX} />
    </>
  ),
  "landscape-row": (
    <>
      <rect x="2.5" y="6" width="5" height="12" rx={RX} />
      <rect x="9.5" y="6" width="5" height="12" rx={RX} />
      <rect x="16.5" y="6" width="5" height="12" rx={RX} />
    </>
  ),
  "vertical-stack": (
    <>
      <rect x="6" y="2.5" width="12" height="5" rx={RX} transform="rotate(180 12 5)" />
      <rect x="6" y="9.5" width="12" height="5" rx={RX} />
      <rect x="6" y="16.5" width="12" height="5" rx={RX} />
    </>
  ),
  free: (
    <>
      <rect x="2.5" y="3" width="9" height="6" rx={RX} transform="rotate(-12 7 6)" />
      <rect x="12.5" y="5" width="9" height="6" rx={RX} transform="rotate(18 17 8)" />
      <rect x="5" y="13" width="9" height="6" rx={RX} transform="rotate(8 9.5 16)" />
      <rect x="13" y="14.5" width="8" height="6" rx={RX} transform="rotate(-22 17 17.5)" />
    </>
  ),
};
