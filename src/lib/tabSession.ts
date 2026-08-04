const CHANNEL_NAME = "manabrew-tab-session";
const HOLDER_REPLY_TIMEOUT_MS = 250;
const RELEASE_TIMEOUT_MS = 3000;

// BroadcastChannel delivers across channel instances within the same tab, so
// a tab probing while it also holds would answer itself without this id.
const TAB_ID = Math.random().toString(36).slice(2);

export type TabSessionRefusal = "hosting";

export type TabSessionClaim =
  | { outcome: "vacant" }
  | { outcome: "released" }
  | { outcome: "refused"; reason: TabSessionRefusal };

export interface TabSessionHolder {
  release(): void;
}

type TabSessionMessage =
  | { type: "claim"; username: string; nonce: string }
  | { type: "releasing"; username: string; nonce: string }
  | { type: "released"; username: string; nonce: string }
  | { type: "refused"; username: string; nonce: string; reason: TabSessionRefusal }
  | { type: "probe"; username: string; tab: string }
  | { type: "held"; username: string; tab: string };

function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

export function claimTabSession(username: string): Promise<TabSessionClaim> {
  const channel = openChannel();
  if (!channel) return Promise.resolve({ outcome: "vacant" });

  const nonce = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (claim: TabSessionClaim) => {
      clearTimeout(replyTimer);
      if (releaseTimer !== null) clearTimeout(releaseTimer);
      channel.close();
      resolve(claim);
    };
    channel.onmessage = (event: MessageEvent<TabSessionMessage>) => {
      const msg = event.data;
      if (!msg || msg.username !== username) return;
      if (msg.type === "probe" || msg.type === "held" || msg.nonce !== nonce) return;
      if (msg.type === "refused") {
        settle({ outcome: "refused", reason: msg.reason });
      } else if (msg.type === "releasing") {
        clearTimeout(replyTimer);
        releaseTimer = setTimeout(() => settle({ outcome: "released" }), RELEASE_TIMEOUT_MS);
      } else if (msg.type === "released") {
        settle({ outcome: "released" });
      }
    };
    const replyTimer = setTimeout(() => settle({ outcome: "vacant" }), HOLDER_REPLY_TIMEOUT_MS);
    channel.postMessage({ type: "claim", username, nonce });
  });
}

// Asks whether another tab of this browser holds the username, without the
// handover side effect of claimTabSession.
export function probeTabSession(username: string): Promise<"held" | "vacant"> {
  const channel = openChannel();
  if (!channel) return Promise.resolve("vacant");

  return new Promise((resolve) => {
    const settle = (result: "held" | "vacant") => {
      clearTimeout(timer);
      channel.close();
      resolve(result);
    };
    channel.onmessage = (event: MessageEvent<TabSessionMessage>) => {
      const msg = event.data;
      if (!msg || msg.type !== "held" || msg.username !== username) return;
      settle("held");
    };
    const timer = setTimeout(() => settle("vacant"), HOLDER_REPLY_TIMEOUT_MS);
    channel.postMessage({ type: "probe", username, tab: TAB_ID });
  });
}

export function holdTabSession(
  username: string,
  handlers: {
    refusal(): TabSessionRefusal | null;
    onRelease(): Promise<void>;
  },
): TabSessionHolder {
  const channel = openChannel();
  if (!channel) return { release() {} };

  channel.onmessage = (event: MessageEvent<TabSessionMessage>) => {
    const msg = event.data;
    if (!msg || msg.username !== username) return;
    if (msg.type === "probe") {
      if (msg.tab !== TAB_ID) channel.postMessage({ type: "held", username, tab: TAB_ID });
      return;
    }
    if (msg.type !== "claim") return;
    const reason = handlers.refusal();
    if (reason) {
      channel.postMessage({ type: "refused", username, nonce: msg.nonce, reason });
      return;
    }
    channel.postMessage({ type: "releasing", username, nonce: msg.nonce });
    void handlers.onRelease().finally(() => {
      channel.postMessage({ type: "released", username, nonce: msg.nonce });
      channel.close();
    });
  };

  return {
    release() {
      channel.close();
    },
  };
}
