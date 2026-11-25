// The decisions an Ironsmith trusted game makes about keeping seats' copies of
// the host's transcript in step. Kept apart from the runtime so they can be tested
// without an engine or a relay.

export const SYNC_RETRY_MS = 2000;
// A seat that keeps asking backs off to this. Applying the first sync takes a
// seat seconds (it starts an engine), so asking every 2 s made the host send the
// whole match config, megabytes with four decks, to each seat over and over.
export const SYNC_RETRY_MAX_MS = 8000;
// The host does not send a seat the same full sync again inside this window.
export const SYNC_RESEND_MS = 10_000;
export const HEAD_INTERVAL_MS = 5000;
// A seat that sees the host's head disagree with its own transcript this many
// times in a row rebuilds its engine; one reading can race an entry in flight.
export const HEAD_RESTART_STRIKES = 2;

/** How long a seat waits before its next sync request, after `attempts` retries. */
export function syncRetryDelay(attempts: number): number {
  return Math.min(SYNC_RETRY_MS * 2 ** attempts, SYNC_RETRY_MAX_MS);
}

/**
 * Host only: whether a seat's sync request asks for a full sync it was already
 * sent moments ago, of the same transcript. Such a seat is still working through
 * the first copy; a second one only adds load.
 */
export function isDuplicateFullSync(params: {
  request: { have: number; restart: boolean };
  transcriptLength: number;
  lastFullSync: { at: number; length: number } | undefined;
  now: number;
}): boolean {
  const { request, transcriptLength, lastFullSync, now } = params;
  // An incremental request costs a few entries, whatever was sent before.
  if (!request.restart && request.have <= transcriptLength) return false;
  return (
    lastFullSync !== undefined &&
    lastFullSync.length === transcriptLength &&
    now - lastFullSync.at < SYNC_RESEND_MS
  );
}

export type HeadVerdict = "agrees" | "behind" | "disagrees";

/** Seat only: how the host's head compares with the seat's own transcript. */
export function judgeHead(
  head: { seq: number; digest: string | null },
  entries: ReadonlyArray<{ digest: string }>,
): HeadVerdict {
  if (head.seq > entries.length) return "behind";
  if (head.seq < entries.length) return "disagrees";
  if (head.seq === 0) return "agrees";
  return entries[head.seq - 1]?.digest === head.digest ? "agrees" : "disagrees";
}
