import { TransportItemType } from "@grafana/faro-web-sdk";
import type { BeforeSendHook } from "@grafana/faro-web-sdk";

export const CLIENT_ANALYTICS_DOMAIN = "manabrew-analytics";
export const CLIENT_ANALYTICS_SCHEMA = {
  screen_view: {
    screen: [
      "home",
      "play",
      "lobby",
      "search",
      "deck-editor",
      "mycollection",
      "hub",
      "game",
      "draft",
      "limited",
      "companion",
      "sealed",
      "winston",
      "gauntlet",
      "settings",
      "about",
      "other",
    ],
    url: "url",
  },
  deck_import: {
    source: ["text", "clipboard"],
    mode: ["create", "add"],
    outcome: ["success", "partial", "failure"],
    duration: ["under-1s", "1-10s", "10-60s", "1-5m", "5m-plus"],
  },
  lobby_wait: {
    outcome: ["started", "left"],
    duration: ["under-1s", "1-10s", "10-60s", "1-5m", "5m-plus"],
  },
  feature_used: {
    feature: ["deck_export", "deck_playtest"],
  },
} as const;

export type ClientAnalyticsEvent = keyof typeof CLIENT_ANALYTICS_SCHEMA;
export type ClientAnalyticsAttributes<N extends ClientAnalyticsEvent> = {
  [K in keyof (typeof CLIENT_ANALYTICS_SCHEMA)[N]]: (typeof CLIENT_ANALYTICS_SCHEMA)[N][K] extends readonly string[]
    ? (typeof CLIENT_ANALYTICS_SCHEMA)[N][K][number]
    : (typeof CLIENT_ANALYTICS_SCHEMA)[N][K] extends "url"
      ? string
      : never;
};

export function safeClientAnalyticsEvent(name: unknown, attributes: unknown) {
  if (
    typeof name !== "string" ||
    !Object.hasOwn(CLIENT_ANALYTICS_SCHEMA, name) ||
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  )
    return undefined;
  const schema = CLIENT_ANALYTICS_SCHEMA[name as ClientAnalyticsEvent];
  const input = attributes as Record<string, unknown>;
  if (
    typeof input.platform !== "string" ||
    !["web", "pwa", "desktop", "mobile"].includes(input.platform)
  )
    return undefined;
  const safe: Record<string, string> = { platform: input.platform };
  if (input.relay_username !== undefined) {
    if (
      typeof input.relay_username !== "string" ||
      !input.relay_username ||
      input.relay_username.length > 256 ||
      input.relay_username.trim() !== input.relay_username ||
      /\p{Cc}/u.test(input.relay_username)
    )
      return undefined;
    safe.relay_username = input.relay_username;
  }
  for (const [key, allowed] of Object.entries(schema)) {
    const value = input[key];
    if (allowed === "url") {
      if (value === undefined) continue;
      const url = analyticsPageUrl(value);
      if (!url) return undefined;
      safe[key] = url;
    } else {
      if (typeof value !== "string" || !(allowed as readonly string[]).includes(value))
        return undefined;
      safe[key] = value;
    }
  }
  return { name: name as ClientAnalyticsEvent, attributes: safe };
}

export function analyticsDuration(
  milliseconds: number,
): ClientAnalyticsAttributes<"lobby_wait">["duration"] {
  if (milliseconds < 1000) return "under-1s";
  if (milliseconds < 10_000) return "1-10s";
  if (milliseconds < 60_000) return "10-60s";
  if (milliseconds < 300_000) return "1-5m";
  return "5m-plus";
}

export function analyticsScreen(
  pathname: string,
): ClientAnalyticsAttributes<"screen_view">["screen"] {
  const segment = pathname.split("/")[1];
  if (!segment) return "home";
  return (CLIENT_ANALYTICS_SCHEMA.screen_view.screen as readonly string[]).includes(segment)
    ? (segment as ClientAnalyticsAttributes<"screen_view">["screen"])
    : "other";
}

export function analyticsPageUrl(value: unknown, base?: string): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  )
    return undefined;
  try {
    const url = new URL(value, base);
    if (
      !["http:", "https:", "tauri:"].includes(url.protocol) ||
      !url.hostname ||
      /^\/(?:auth|callback|dev|card-mock|design-system)(?:\/|$)/i.test(
        decodeURIComponent(url.pathname),
      )
    )
      return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href.length <= 2048 ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function createAnalyticsPrivacyFilter(environment: string): BeforeSendHook {
  return (item) => {
    if (item.type !== TransportItemType.EVENT) return null;
    const payload = item.payload as {
      name?: unknown;
      attributes?: unknown;
      domain?: unknown;
      timestamp?: string;
    };
    if (payload.domain !== CLIENT_ANALYTICS_DOMAIN) return null;
    const event = safeClientAnalyticsEvent(payload.name, payload.attributes);
    if (typeof payload.timestamp !== "string") return null;
    if (!event) return null;
    const app = item.meta.app;
    return {
      type: TransportItemType.EVENT,
      payload: { ...event, domain: CLIENT_ANALYTICS_DOMAIN, timestamp: payload.timestamp },
      meta: {
        app: { name: "manabrew-client", version: app?.version, release: app?.release, environment },
      },
    };
  };
}
