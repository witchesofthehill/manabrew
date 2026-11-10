import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { trackClientEvent } from "@/lib/clientAnalytics";
import { analyticsPageUrl, analyticsScreen } from "@/lib/clientAnalyticsPrivacy";
import { observeClientAnalyticsLobby, resetClientAnalyticsLobby } from "@/lib/clientAnalyticsLobby";
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
    if (excluded) {
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
