import { TransportItemType } from "@grafana/faro-web-sdk";
import type { BeforeSendHook } from "@grafana/faro-web-sdk";

export const CLIENT_ANALYTICS_DOMAIN = "manabrew-analytics";
export const ANALYTICS_MATCH_SOURCES = [
  "my_deck",
  "preset",
  "community",
  "offline_setup",
  "gauntlet",
  "lobby_host",
  "lobby_join",
  "invite",
  "limited",
] as const;
export const ANALYTICS_ACQUISITIONS = [
  "direct",
  "website",
  "app",
  "search",
  "reddit",
  "discord",
  "youtube",
  "twitch",
  "twitter",
  "bluesky",
  "github",
  "moxfield",
  "archidekt",
  "edhrec",
  "mtggoldfish",
  "scryfall",
  "newsletter",
  "other",
] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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
  first_game_funnel: {
    stage: ["observed", "match_requested", "game_started"],
    clicks: "count",
    source: ANALYTICS_MATCH_SOURCES,
    acquisition: ANALYTICS_ACQUISITIONS,
  },
} as const;
const OPTIONAL_ATTRIBUTES: Partial<Record<string, readonly string[]>> = {
  first_game_funnel: ["source", "acquisition"],
};

export type ClientAnalyticsEvent = keyof typeof CLIENT_ANALYTICS_SCHEMA;
type OptionalAttribute<N extends ClientAnalyticsEvent> = N extends "first_game_funnel"
  ? "source" | "acquisition"
  : never;
type SchemaAttributes<N extends ClientAnalyticsEvent> = {
  [K in keyof (typeof CLIENT_ANALYTICS_SCHEMA)[N]]: (typeof CLIENT_ANALYTICS_SCHEMA)[N][K] extends readonly string[]
    ? (typeof CLIENT_ANALYTICS_SCHEMA)[N][K][number]
    : (typeof CLIENT_ANALYTICS_SCHEMA)[N][K] extends "url" | "count"
      ? string
      : never;
};
export type ClientAnalyticsAttributes<N extends ClientAnalyticsEvent> = Omit<
  SchemaAttributes<N>,
  OptionalAttribute<N>
> &
  Partial<Pick<SchemaAttributes<N>, Extract<OptionalAttribute<N>, keyof SchemaAttributes<N>>>>;

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
  if (input.visit_id !== undefined) {
    if (typeof input.visit_id !== "string" || !UUID_PATTERN.test(input.visit_id)) return undefined;
    safe.visit_id = input.visit_id;
  }
  if (name === "first_game_funnel" && (!safe.relay_username || !safe.visit_id)) return undefined;
  for (const [key, allowed] of Object.entries(schema)) {
    const value = input[key];
    if (value === undefined && OPTIONAL_ATTRIBUTES[name]?.includes(key)) continue;
    if (allowed === "url") {
      if (value === undefined) continue;
      const url = analyticsPageUrl(value);
      if (!url) return undefined;
      safe[key] = url;
    } else if (allowed === "count") {
      if (typeof value !== "string" || value.length > 9) return undefined;
      const count = Number(value);
      if (!Number.isInteger(count) || count < 0 || String(count) !== value) return undefined;
      safe[key] = value;
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

const UTM_ACQUISITIONS: Record<
  string,
  ClientAnalyticsAttributes<"first_game_funnel">["acquisition"]
> = {
  reddit: "reddit",
  discord: "discord",
  youtube: "youtube",
  twitch: "twitch",
  twitter: "twitter",
  x: "twitter",
  bluesky: "bluesky",
  github: "github",
  google: "search",
  moxfield: "moxfield",
  archidekt: "archidekt",
  edhrec: "edhrec",
  mtggoldfish: "mtggoldfish",
  scryfall: "scryfall",
  newsletter: "newsletter",
  email: "newsletter",
};
const REFERRER_ACQUISITIONS: Array<
  [RegExp, ClientAnalyticsAttributes<"first_game_funnel">["acquisition"]]
> = [
  [/(^|\.)reddit\.com$|^redd\.it$/, "reddit"],
  [/(^|\.)discord(app)?\.com$|^discord\.gg$/, "discord"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"],
  [/(^|\.)twitch\.tv$/, "twitch"],
  [/(^|\.)(twitter|x)\.com$|^t\.co$/, "twitter"],
  [/(^|\.)bsky\.app$/, "bluesky"],
  [/(^|\.)github\.com$/, "github"],
  [
    /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.brave\.com|ecosia\.org|yahoo\.com)$/,
    "search",
  ],
  [/(^|\.)moxfield\.com$/, "moxfield"],
  [/(^|\.)archidekt\.com$/, "archidekt"],
  [/(^|\.)edhrec\.com$/, "edhrec"],
  [/(^|\.)mtggoldfish\.com$/, "mtggoldfish"],
  [/(^|\.)scryfall\.com$/, "scryfall"],
  [/(^|\.)manabrew\.app$/, "website"],
];

export function analyticsAcquisition(
  href: string,
  referrer: string,
  platform: string,
): ClientAnalyticsAttributes<"first_game_funnel">["acquisition"] {
  try {
    const utm = new URL(href).searchParams.get("utm_source")?.trim().toLowerCase();
    if (utm) return UTM_ACQUISITIONS[utm] ?? "other";
    if (platform === "desktop" || platform === "mobile") return "app";
    if (!referrer) return "direct";
    const host = new URL(referrer).hostname.toLowerCase();
    if (host === new URL(href).hostname.toLowerCase()) return "direct";
    return REFERRER_ACQUISITIONS.find(([pattern]) => pattern.test(host))?.[1] ?? "other";
  } catch {
    return "other";
  }
}

const STATIC_PATH_SEGMENTS = new Set(["multiplayer", "top"]);

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
    const [, first = "", ...rest] = url.pathname.split("/");
    const route = [
      first,
      ...rest
        .filter(Boolean)
        .map((segment) => (STATIC_PATH_SEGMENTS.has(segment) ? segment : ":id")),
    ];
    return `${url.protocol}//${url.host}/${route.join("/")}`;
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
