import { useEffect, useState } from "react";
import { useLimitedDraftClockStore } from "@/stores/useLimitedDraftClockStore";

export function useDraftClock(sessionId: string, seatNumber = 0) {
  const clock = useLimitedDraftClockStore((state) => state.sessions[sessionId]);
  const seat = clock?.seats.find((entry) => entry.seat === seatNumber);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!seat?.deadlineMs || clock?.paused) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [seat?.deadlineMs, clock?.paused]);
  const remainingMs = seat
    ? seat.deadlineMs === null
      ? seat.remainingMs
      : Math.max(0, seat.deadlineMs - now)
    : 0;
  return {
    clock,
    seat,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    nominatedId: seat?.nominatedId ?? null,
  };
}
