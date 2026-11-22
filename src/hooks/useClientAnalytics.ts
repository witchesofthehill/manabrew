import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { isClientAnalyticsEnabled, trackClientEvent } from "@/lib/clientAnalytics";
import { analyticsPageUrl, analyticsScreen } from "@/lib/clientAnalyticsPrivacy";
import { observeClientAnalyticsLobby, resetClientAnalyticsLobby } from "@/lib/clientAnalyticsLobby";
import {
  listenClientAnalyticsFunnel,
  observeClientAnalyticsGame,
  observeClientAnalyticsIdentity,
} from "@/lib/clientAnalyticsFunnel";
import { useAuthStore } from "@/stores/useAuthStore";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";

export function useClientAnalytics() {
  const { pathname } = useLocation();
  const previousPathname = useRef<string | undefined>(undefined);
  const url = analyticsPageUrl(pathname, window.location.href);
  const excluded = url === undefined;

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    if (!url) return;
    trackClientEvent("screen_view", { screen: analyticsScreen(pathname), url });
  }, [pathname, url]);

  useEffect(() => {
    if (excluded || !isClientAnalyticsEnabled()) return;
    observeClientAnalyticsGame(useGameStore.getState());
    const stopListening = listenClientAnalyticsFunnel();
    const unsubscribeGame = useGameStore.subscribe(observeClientAnalyticsGame);
    const unsubscribeAuth = useAuthStore.subscribe(observeClientAnalyticsIdentity);
    const unsubscribePreferences = usePreferencesStore.subscribe(observeClientAnalyticsIdentity);
    return () => {
      stopListening?.();
      unsubscribeGame();
      unsubscribeAuth();
      unsubscribePreferences();
    };
  }, [excluded, pathname]);

  useEffect(() => {
    if (excluded || !isClientAnalyticsEnabled()) {
      resetClientAnalyticsLobby();
      return;
    }
    const server = useServerStore.getState();
    observeClientAnalyticsLobby(server.currentRoom, server.gameStarted);
    return useServerStore.subscribe((state) =>
      observeClientAnalyticsLobby(state.currentRoom, state.gameStarted),
    );
  }, [excluded]);
}
