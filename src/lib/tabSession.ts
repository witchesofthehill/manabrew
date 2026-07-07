const CHANNEL_NAME = "manabrew-tab-session";
const HOLDER_REPLY_TIMEOUT_MS = 250;
const RELEASE_TIMEOUT_MS = 3000;

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
  | { type: "refused"; username: string; nonce: string; reason: TabSessionRefusal };

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
      if (!msg || msg.username !== username || msg.nonce !== nonce) return;
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
    if (!msg || msg.type !== "claim" || msg.username !== username) return;
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
