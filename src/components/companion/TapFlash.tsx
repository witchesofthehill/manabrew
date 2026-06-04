interface TapFlashProps {
  decTick: number;
  incTick: number;
}

export function TapFlash({ decTick, incTick }: TapFlashProps) {
  return (
    <>
      {decTick > 0 && (
        <div
          key={`dec-${decTick}`}
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-1/2 animate-companion-tap-flash bg-gradient-to-r from-rose-500/60 to-rose-500/0"
          aria-hidden
        />
      )}
      {incTick > 0 && (
        <div
          key={`inc-${incTick}`}
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-1/2 animate-companion-tap-flash bg-gradient-to-l from-emerald-400/60 to-emerald-400/0"
          aria-hidden
        />
      )}
    </>
  );
}
