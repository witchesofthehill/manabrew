export const ACQUISITION_SOURCES = [
  "direct",
  "landing",
  "reddit",
  "discord",
  "search",
  "ai",
  "youtube",
  "social",
  "github",
  "other",
] as const;

export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

export const ACQUISITION_PARAM = "src";

const HOST_BUCKETS: [AcquisitionSource, string[]][] = [
  ["landing", ["manabrew.app"]],
  ["reddit", ["reddit.com", "redd.it", "reddit"]],
  ["discord", ["discord.com", "discord.gg", "discordapp.com", "discord"]],
  [
    "ai",
    [
      "chatgpt.com",
      "chat.openai.com",
      "openai.com",
      "perplexity.ai",
      "claude.ai",
      "gemini.google.com",
      "copilot.microsoft.com",
      "chatgpt",
    ],
  ],
  ["youtube", ["youtube.com", "youtu.be", "youtube"]],
  [
    "search",
    [
      "google.com",
      "bing.com",
      "duckduckgo.com",
      "search.yahoo.com",
      "ecosia.org",
      "search.brave.com",
      "kagi.com",
      "yandex.ru",
      "google",
      "bing",
    ],
  ],
  [
    "social",
    [
      "x.com",
      "t.co",
      "twitter.com",
      "facebook.com",
      "instagram.com",
      "bsky.app",
      "threads.net",
      "tiktok.com",
      "twitter",
      "facebook",
      "bluesky",
    ],
  ],
  ["github", ["github.com", "github"]],
];

function bucketForHost(raw: string): AcquisitionSource {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  for (const [bucket, hosts] of HOST_BUCKETS) {
    if (
      hosts.some(
        (known) =>
          host === known ||
          host.endsWith(`.${known}`) ||
          (!known.includes(".") && host.split(".").includes(known)),
      )
    )
      return bucket;
  }
  return "other";
}

function isAcquisitionSource(value: string | null): value is AcquisitionSource {
  return ACQUISITION_SOURCES.includes(value as AcquisitionSource);
}

function referrerHost(referrer: string): string | null {
  try {
    return referrer ? new URL(referrer).hostname : null;
  } catch {
    return null;
  }
}

export function classifyAcquisition(url: string, referrer: string): AcquisitionSource {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    params = new URLSearchParams();
  }
  const forwarded = params.get(ACQUISITION_PARAM);
  if (isAcquisitionSource(forwarded)) return forwarded;
  const utm = params.get("utm_source");
  if (utm) return bucketForHost(utm);
  const host = referrerHost(referrer);
  if (!host) return "direct";
  const ownHost = referrerHost(url);
  if (ownHost && host === ownHost) return "direct";
  return bucketForHost(host);
}
