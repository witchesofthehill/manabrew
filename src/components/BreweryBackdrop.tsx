export function BreweryBackdrop() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background via-card/40 to-background"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-border to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[28%] size-[60vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[60%] size-[45vw] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl"
      />
      {/* Brewery scene as a full-viewport backdrop. 16:9 source covers
        any viewport via `object-cover`. Blur is `blur-md` here so the
        scene reads as a recognizable place behind the haze, not a pure
        color wash.
        NOTE: when swapping back to a logo / wordmark source (square,
        high-contrast graphic), `blur-3xl` looked right — graphic shapes
        need heavier blur to dissolve into atmosphere. */}
      <img
        aria-hidden
        src="/manabrew_brewery_1.png"
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 size-full select-none object-cover opacity-50 blur-md"
      />
    </>
  );
}
