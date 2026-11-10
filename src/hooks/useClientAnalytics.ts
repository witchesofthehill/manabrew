import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { trackClientEvent } from "@/lib/clientAnalytics";
import { analyticsScreen } from "@/lib/clientAnalyticsPrivacy";
import { observeClientAnalyticsLobby, resetClientAnalyticsLobby } from "@/lib/clientAnalyticsLobby";
import { useServerStore } from "@/stores/useServerStore";

export function useClientAnalytics() {
  const { pathname } = useLocation();
  const previousPathname = useRef<string | undefined>(undefined);
  const excluded = /^\/(?:auth|callback|dev|card-mock|design-system)(?:\/|$)/.test(pathname);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    if (excluded) return;
    trackClientEvent("screen_view", { screen: analyticsScreen(pathname) });
  }, [pathname, excluded]);

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
