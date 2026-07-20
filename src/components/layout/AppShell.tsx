import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useServerStore } from "@/stores/useServerStore";
import { useGameStore } from "@/stores/useGameStore";
import { cn } from "@/lib/utils";
import { useGameSessionResume } from "@/hooks/useGameSessionResume";
import { useKeybindings } from "@/hooks/useKeybindings";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { IronsmithUnsupportedDeckModal } from "@/components/IronsmithUnsupportedDeckModal";
import { StatusBanner } from "./StatusBanner";
import { TopBar } from "./TopBar";
import { TopBarOverrideContext, type TopBarOverride } from "./TopBarOverride";
import { useStatusBanner } from "@/hooks/useStatusBanner";
import { useDesktopUpdater } from "@/hooks/useDesktopUpdater";
import { useEngineHostCloseGuard } from "@/hooks/useEngineHostCloseGuard";
import { ROUTES } from "@/lib/constants";

// Drives previous/next page shortcuts.
const NAV_ROUTES = [ROUTES.PLAY, ROUTES.SEARCH, ROUTES.DECK_EDITOR, ROUTES.COMPANION];

export function AppShell() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [topBarOverride, setTopBarOverride] = useState<TopBarOverride | null>(null);
  const setupListeners = useServerStore((s) => s.setupListeners);
  const location = useLocation();
  const navigate = useNavigate();
  const isGameActive = useGameStore((s) => s.isGameActive);
  const isTabletopRoute = location.pathname.startsWith(ROUTES.TABLETOP);
  const isGameRoute = location.pathname.startsWith(ROUTES.GAME) || isGameActive;
  const isCompanionRoute = location.pathname.startsWith(ROUTES.COMPANION);
  const isImmersiveRoute = isGameRoute || isCompanionRoute;
  const hideNavChrome = isGameRoute && !isTabletopRoute;
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

  useGameSessionResume();
  useStatusBanner();
  useDesktopUpdater();
  useEngineHostCloseGuard();

  function goToAdjacentPage(delta: number) {
    if (hideNavChrome) return;
    const current = NAV_ROUTES.findIndex((r) => location.pathname.startsWith(r));
    const base = current === -1 ? 0 : current;
    const next = (base + delta + NAV_ROUTES.length) % NAV_ROUTES.length;
    navigate(NAV_ROUTES[next]);
  }

  useKeybindings({
    "nav-prev-page": () => goToAdjacentPage(-1),
    "nav-next-page": () => goToAdjacentPage(1),
    "open-settings": () => {
      if (!isGameActive) navigate(ROUTES.SETTINGS);
    },
    "show-shortcuts": () => setShortcutsOpen((v) => !v),
  });

  return (
    <TopBarOverrideContext.Provider value={setTopBarOverride}>
      <div className="h-[100dvh] overflow-hidden flex flex-col">
        <StatusBanner />
        <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <IronsmithUnsupportedDeckModal />
        {!hideNavChrome && <TopBar override={activeTopBarOverride} />}
        <main
          className={cn(
            "flex-1 min-h-0 overflow-auto",
            !isImmersiveRoute &&
              "pb-[var(--safe-area-inset-bottom)] pl-[var(--safe-area-inset-left)] pr-[var(--safe-area-inset-right)]",
            isImmersiveRoute && "!p-0 !overflow-hidden",
            isTabletopRoute && isGameRoute && "[--safe-area-inset-top:0px]",
          )}
        >
          <Outlet />
        </main>
      </div>
    </TopBarOverrideContext.Provider>
  );
}
