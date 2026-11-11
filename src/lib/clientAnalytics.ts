import { InternalLoggerLevel } from "@grafana/faro-web-sdk";
import type { Faro } from "@grafana/faro-web-sdk";
import { getClientPlatform } from "@/platform/clientPlatform";
import { relayUsername } from "@/lib/relayUsername";
import { clientTelemetryConfig } from "@/lib/clientTelemetryConfig";
import { createClientTelemetryTransport } from "@/lib/clientTelemetryTransport";
import {
  CLIENT_ANALYTICS_DOMAIN,
  createAnalyticsPrivacyFilter,
  safeClientAnalyticsEvent,
} from "@/lib/clientAnalyticsPrivacy";
import type { ClientAnalyticsAttributes, ClientAnalyticsEvent } from "@/lib/clientAnalyticsPrivacy";

const MAX_EVENTS_PER_PAGE = 500;
let faro: Faro | undefined;
let disposeTransport: (() => void) | undefined;
let initialized = false;
let eventsThisPage = 0;

export function isClientAnalyticsEnabled(): boolean {
  return faro !== undefined;
}

export function captureClientEvent<N extends ClientAnalyticsEvent>(
  name: N,
  attributes: ClientAnalyticsAttributes<N>,
): (() => void) | undefined {
  if (!faro) return;
  const event = safeClientAnalyticsEvent(name, {
    ...attributes,
    platform: getClientPlatform(),
    relay_username: relayUsername(),
  });
  if (event) return () => pushClientEvent(event);
}

function pushClientEvent(event: { name: string; attributes: Record<string, string> }): void {
  if (!faro || (event.name !== "first_game_funnel" && eventsThisPage >= MAX_EVENTS_PER_PAGE))
    return;
  if (event.name !== "first_game_funnel") eventsThisPage++;
  const batching = faro.config.batching;
  try {
    if (event.name === "first_game_funnel") faro.config.batching = { enabled: false };
    faro.api.pushEvent(event.name, event.attributes, CLIENT_ANALYTICS_DOMAIN, { skipDedupe: true });
  } catch {
    return;
  } finally {
    faro.config.batching = batching;
  }
}

export function initializeClientAnalytics(): void {
  if (initialized) return;
  initialized = true;
  try {
    const config = clientTelemetryConfig();
    if (!config) return;
    const delivery = createClientTelemetryTransport(config.collectorUrl);
    disposeTransport = delivery.dispose;
    faro = delivery.initialize({
      app: {
        name: "manabrew-client",
        version: __APP_VERSION__,
        release: __APP_BUILD_ID__,
        environment: config.environment,
      },
      instrumentations: [],
      metas: [],
      sessionTracking: { enabled: false },
      preventGlobalExposure: true,
      isolate: true,
      dedupe: false,
      internalLoggerLevel: InternalLoggerLevel.OFF,
      batching: { enabled: true, itemLimit: 10, sendTimeout: 1000 },
      transports: [delivery.transport],
      beforeSend: createAnalyticsPrivacyFilter(config.environment),
    });
  } catch {
    disposeClientAnalytics();
  }
}

export function trackClientEvent<N extends ClientAnalyticsEvent>(
  name: N,
  attributes: ClientAnalyticsAttributes<N>,
): void {
  if (!faro) return;
  try {
    const event = safeClientAnalyticsEvent(name, {
      ...attributes,
      platform: getClientPlatform(),
      relay_username: relayUsername(),
    });
    if (!event) return;
    pushClientEvent(event);
  } catch {
    return;
  }
}

function disposeClientAnalytics(): void {
  faro?.pause();
  disposeTransport?.();
  disposeTransport = undefined;
  faro = undefined;
  eventsThisPage = 0;
}

if (import.meta.hot) import.meta.hot.dispose(disposeClientAnalytics);
