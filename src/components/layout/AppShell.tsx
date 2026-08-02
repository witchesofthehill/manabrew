import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { isFeatureEnabled } from "@/featureFlags";
import { useServerStore } from "@/stores/useServerStore";
import { useGameStore } from "@/stores/useGameStore";
import { cn } from "@/lib/utils";
import { useGameSessionResume } from "@/hooks/useGameSessionResume";
import { useKeybindings } from "@/hooks/useKeybindings";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { IronsmithUnsupportedDeckModal } from "@/components/IronsmithUnsupportedDeckModal";
import { SignInDialog } from "@/components/auth/SignInDialog";
import { useAuthStore } from "@/stores/useAuthStore";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { StatusBanner } from "./StatusBanner";
import { TopBar } from "./TopBar";
import { TopBarOverrideContext, type TopBarOverride } from "./TopBarOverride";
import { useStatusBanner } from "@/hooks/useStatusBanner";
import { useDesktopUpdater } from "@/hooks/useDesktopUpdater";
import { useEngineHostCloseGuard } from "@/hooks/useEngineHostCloseGuard";
import { ROUTES } from "@/lib/constants";
import { flushPublishedDeckPlayReports } from "@/lib/deckPlayEvidence";

// Drives previous/next page shortcuts.
const NAV_ROUTES = [ROUTES.PLAY, ROUTES.LOBBY, ROUTES.SEARCH, ROUTES.DECK_EDITOR, ROUTES.COMPANION];

export function AppShell() {
  const accountsEnabled = isFeatureEnabled("accounts");
  const deckHubEnabled = isFeatureEnabled("deckHub");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [topBarOverride, setTopBarOverride] = useState<TopBarOverride | null>(null);
  const setupListeners = useServerStore((s) => s.setupListeners);
  const location = useLocation();
  const navigate = useNavigate();
  const isGameActive = useGameStore((s) => s.isGameActive);
  const pathname =
    location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname;
  const isGameRoute = pathname.startsWith(ROUTES.GAME) || isGameActive;
  const isCompanionRoute = pathname.startsWith(ROUTES.COMPANION);
  const isImmersiveRoute = isGameRoute || isCompanionRoute;
  const isPlayHome = pathname === ROUTES.PLAY;
  const usesSubtleBackdrop =
    pathname.startsWith(ROUTES.SEARCH) ||
    pathname.startsWith(ROUTES.DECK_EDITOR) ||
    pathname.startsWith(ROUTES.HUB) ||
    pathname.startsWith(ROUTES.DRAFT) ||
    pathname.startsWith(ROUTES.SEALED) ||
    pathname.startsWith(ROUTES.WINSTON) ||
    pathname.startsWith(ROUTES.GAUNTLET) ||
    pathname.startsWith(ROUTES.DESIGN_SYSTEM) ||
    pathname === "/card-mock";
  const hideNavChrome = isGameRoute;
  const activeTopBarOverride =
    topBarOverride?.locationKey === location.key &&
    topBarOverride.pathname === location.pathname &&
    topBarOverride.search === location.search
      ? topBarOverride
      : undefined;

  // Register Tauri event listeners at app level so they're always active.
  useEffect(() => {
    const cleanup = setupListeners();
    return cleanup;
  }, [setupListeners]);

  useEffect(() => {
    if (accountsEnabled) void useAuthStore.getState().hydrate();
  }, [accountsEnabled]);

  useEffect(() => {
    if (!deckHubEnabled) return;
    const flush = () => void flushPublishedDeckPlayReports();
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [deckHubEnabled]);

  useGameSessionResume();
  useStatusBanner();
  useDesktopUpdater();
  useEngineHostCloseGuard();

  function goToAdjacentPage(delta: number) {
    if (isGameActive || hideNavChrome || activeTopBarOverride?.navigationDisabled) return;
    const current = NAV_ROUTES.findIndex((r) => location.pathname.startsWith(r));
    const base = current === -1 ? 0 : current;
    const next = (base + delta + NAV_ROUTES.length) % NAV_ROUTES.length;
    navigate(NAV_ROUTES[next]);
  }

  useKeybindings({
    "nav-prev-page": () => goToAdjacentPage(-1),
    "nav-next-page": () => goToAdjacentPage(1),
    "open-settings": () => {
      if (!isGameActive && !activeTopBarOverride?.navigationDisabled) navigate(ROUTES.SETTINGS);
    },
    "show-shortcuts": () => setShortcutsOpen((v) => !v),
  });

  return (
    <TopBarOverrideContext.Provider value={setTopBarOverride}>
      <div className="h-[100dvh] overflow-hidden flex flex-col">
        <StatusBanner />
        <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <IronsmithUnsupportedDeckModal />
        {accountsEnabled && <SignInDialog />}
        {!hideNavChrome && <TopBar override={activeTopBarOverride} />}
        <main
          className={cn(
            "relative isolate flex-1 min-h-0 overflow-auto",
            !isImmersiveRoute &&
              "pb-[var(--safe-area-inset-bottom)] pl-[var(--safe-area-inset-left)] pr-[var(--safe-area-inset-right)]",
            isImmersiveRoute && "!p-0 !overflow-hidden",
          )}
        >
          {!isImmersiveRoute && (
            <BreweryBackdrop
              variant={isPlayHome ? "hero" : usesSubtleBackdrop ? "subtle" : "ambient"}
              className="-z-10"
            />
          )}
          {/* Play cancels in-flight launches on unmount, so keep the outlet stable here. */}
          <Outlet />
        </main>
      </div>
    </TopBarOverrideContext.Provider>
  );
}
