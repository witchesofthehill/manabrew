import { InternalLoggerLevel } from "@grafana/faro-web-sdk";
import type { Faro } from "@grafana/faro-web-sdk";
import { getClientPlatform } from "@/platform/clientPlatform";
import { relayUsername } from "@/lib/relayUsername";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { clientTelemetryConfig } from "@/lib/clientTelemetryConfig";
import { createClientTelemetryTransport } from "@/lib/clientTelemetryTransport";
import {
  CLIENT_ANALYTICS_DOMAIN,
  createAnalyticsPrivacyFilter,
  safeClientAnalyticsEvent,
} from "@/lib/clientAnalyticsPrivacy";
import type { ClientAnalyticsAttributes, ClientAnalyticsEvent } from "@/lib/clientAnalyticsPrivacy";

const MAX_EVENTS_PER_PAGE = 500;
const MAX_FUNNEL_CHECKPOINTS_PER_PAGE = 200;
let faro: Faro | undefined;
let disposeTransport: (() => void) | undefined;
let initialized = false;
let eventsThisPage = 0;
let funnelCheckpointsThisPage = 0;
let visitId = crypto.randomUUID();

export function renewClientVisitId(): void {
  visitId = crypto.randomUUID();
}

function optedOut(): boolean {
  const navigatorPrivacy = navigator as Navigator & { globalPrivacyControl?: boolean };
  return (
    navigatorPrivacy.globalPrivacyControl === true || !usePreferencesStore.getState().usageAnalytics
  );
}

export function isClientAnalyticsEnabled(): boolean {
  return faro !== undefined && !optedOut();
}

export function captureClientEvent<N extends ClientAnalyticsEvent>(
  name: N,
  attributes: ClientAnalyticsAttributes<N>,
): (() => void) | undefined {
  if (!isClientAnalyticsEnabled()) return;
  const event = safeClientAnalyticsEvent(name, {
    ...attributes,
    platform: getClientPlatform(),
    relay_username: relayUsername(),
    visit_id: visitId,
  });
  if (event) return () => pushClientEvent(event);
}

function pushClientEvent(event: { name: string; attributes: Record<string, string> }): void {
  if (!faro || optedOut()) return;
  if (event.name !== "first_game_funnel") {
    if (eventsThisPage >= MAX_EVENTS_PER_PAGE) return;
    eventsThisPage++;
  } else if (event.attributes.stage !== "game_started") {
    if (funnelCheckpointsThisPage >= MAX_FUNNEL_CHECKPOINTS_PER_PAGE) return;
    funnelCheckpointsThisPage++;
  }
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
  if (!isClientAnalyticsEnabled()) return;
  try {
    const event = safeClientAnalyticsEvent(name, {
      ...attributes,
      platform: getClientPlatform(),
      relay_username: relayUsername(),
      visit_id: visitId,
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
  funnelCheckpointsThisPage = 0;
}

if (import.meta.hot) import.meta.hot.dispose(disposeClientAnalytics);
