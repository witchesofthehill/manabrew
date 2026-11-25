import { describe, expect, it } from "vitest";
import {
  SYNC_RESEND_MS,
  SYNC_RETRY_MAX_MS,
  SYNC_RETRY_MS,
  isDuplicateFullSync,
  judgeHead,
  syncRetryDelay,
} from "./ironsmithSyncPolicy";

describe("syncRetryDelay", () => {
  it("backs off and stops growing at the cap", () => {
    expect(syncRetryDelay(0)).toBe(SYNC_RETRY_MS);
    expect(syncRetryDelay(1)).toBe(SYNC_RETRY_MS * 2);
    expect(syncRetryDelay(2)).toBe(SYNC_RETRY_MS * 4);
    expect(syncRetryDelay(3)).toBe(SYNC_RETRY_MAX_MS);
    expect(syncRetryDelay(50)).toBe(SYNC_RETRY_MAX_MS);
  });

  it("asks far less often than every 2 s while a seat is still working", () => {
    let t = 0;
    let asks = 0;
    for (let attempts = 0; t < 40_000; attempts++) {
      t += syncRetryDelay(attempts);
      asks++;
    }
    // Every 2 s would be 20 asks in 40 s.
    expect(asks).toBeLessThanOrEqual(8);
  });
});

describe("isDuplicateFullSync", () => {
  const sentAt = 100_000;
  const last = { at: sentAt, length: 0 };

  it("drops a repeated restart request for the transcript the seat was just sent", () => {
    expect(
      isDuplicateFullSync({
        request: { have: 0, restart: true },
        transcriptLength: 0,
        lastFullSync: last,
        now: sentAt + 2000,
      }),
    ).toBe(true);
  });

  it("answers again once the window has passed", () => {
    expect(
      isDuplicateFullSync({
        request: { have: 0, restart: true },
        transcriptLength: 0,
        lastFullSync: last,
        now: sentAt + SYNC_RESEND_MS,
      }),
    ).toBe(false);
  });

  it("answers when the transcript has moved on, since an older sync would miss entries", () => {
    expect(
      isDuplicateFullSync({
        request: { have: 0, restart: true },
        transcriptLength: 1,
        lastFullSync: last,
        now: sentAt + 2000,
      }),
    ).toBe(false);
  });

  it("answers a seat nothing was sent to", () => {
    expect(
      isDuplicateFullSync({
        request: { have: 0, restart: true },
        transcriptLength: 0,
        lastFullSync: undefined,
        now: sentAt,
      }),
    ).toBe(false);
  });

  it("always answers an incremental request", () => {
    expect(
      isDuplicateFullSync({
        request: { have: 3, restart: false },
        transcriptLength: 5,
        lastFullSync: { at: sentAt, length: 5 },
        now: sentAt + 100,
      }),
    ).toBe(false);
  });

  it("treats a seat ahead of the host as a full-sync request", () => {
    expect(
      isDuplicateFullSync({
        request: { have: 9, restart: false },
        transcriptLength: 5,
        lastFullSync: { at: sentAt, length: 5 },
        now: sentAt + 100,
      }),
    ).toBe(true);
  });
});

describe("judgeHead", () => {
  const entries = [{ digest: "a" }, { digest: "b" }];

  it("agrees on an empty transcript", () => {
    expect(judgeHead({ seq: 0, digest: null }, [])).toBe("agrees");
  });

  it("agrees when length and last digest match", () => {
    expect(judgeHead({ seq: 2, digest: "b" }, entries)).toBe("agrees");
  });

  it("is behind when the host has entries the seat never got", () => {
    expect(judgeHead({ seq: 3, digest: "c" }, entries)).toBe("behind");
    expect(judgeHead({ seq: 1, digest: "a" }, [])).toBe("behind");
  });

  it("disagrees when the seat has more than the host, or a different last entry", () => {
    expect(judgeHead({ seq: 1, digest: "a" }, entries)).toBe("disagrees");
    expect(judgeHead({ seq: 2, digest: "x" }, entries)).toBe("disagrees");
  });
});
