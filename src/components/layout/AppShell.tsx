import { useEffect, useEffectEvent, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useServerStore } from "@/stores/useServerStore";
import { useGameStore } from "@/stores/useGameStore";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGameSessionResume } from "@/hooks/useGameSessionResume";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useKeybindings } from "@/hooks/useKeybindings";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { IronsmithUnsupportedDeckModal } from "@/components/IronsmithUnsupportedDeckModal";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ManaBrewLogo } from "./ManaBrewLogo";
import { DESKTOP_QUERY } from "@/lib/responsive";
import { StatusBanner } from "./StatusBanner";
import { useStatusBanner } from "@/hooks/useStatusBanner";
import { useDesktopUpdater } from "@/hooks/useDesktopUpdater";
import { useEngineHostCloseGuard } from "@/hooks/useEngineHostCloseGuard";

// Order mirrors the primary nav in Sidebar; drives prev/next page shortcuts.
const NAV_ROUTES = [
  "/play",
  "/lobby",
  "/search",
  "/deck-editor",
  "/companion",
  "/limited",
  "/matches",
];

export function AppShell() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const setupListeners = useServerStore((s) => s.setupListeners);
  const location = useLocation();
  const navigate = useNavigate();
  const isGameActive = useGameStore((s) => s.isGameActive);
  const isTabletopRoute = location.pathname.startsWith("/tabletop");
  const isGameRoute = location.pathname.startsWith("/game") || isGameActive;
  const isCompanionRoute = location.pathname.startsWith("/companion");
  const isImmersiveRoute = isGameRoute || isCompanionRoute;
  const hideNavChrome = isGameRoute && !isTabletopRoute;

  // Register Tauri event listeners at app level so they're always active.
  useEffect(() => {
    const cleanup = setupListeners();
    return cleanup;
  }, [setupListeners]);

  useGameSessionResume();
  useStatusBanner();
  useDesktopUpdater();
  useEngineHostCloseGuard();

  function toggleSidebar() {
    setSidebarCollapsed((v) => !v);
  }

  function goToAdjacentPage(delta: number) {
    if (hideNavChrome) return;
    const current = NAV_ROUTES.findIndex((r) => location.pathname.startsWith(r));
    const base = current === -1 ? 0 : current;
    const next = (base + delta + NAV_ROUTES.length) % NAV_ROUTES.length;
    navigate(NAV_ROUTES[next]);
  }

  useKeybindings({
    "toggle-sidebar": toggleSidebar,
    "nav-prev-page": () => goToAdjacentPage(-1),
    "nav-next-page": () => goToAdjacentPage(1),
    "open-settings": () => {
      if (!isGameActive) navigate("/settings");
    },
    "show-shortcuts": () => setShortcutsOpen((v) => !v),
  });

  // Close mobile nav on route change.
  const [prevPathname, setPrevPathname] = useState(location.pathname);
  if (prevPathname !== location.pathname) {
    setPrevPathname(location.pathname);
    setMobileNavOpen(false);
  }

  // Collapse sidebar when a game starts, expand when it ends (return
  // to menu). The URL may stay at /play or /lobby, so watching the
  // store flag is more reliable than the pathname alone.
  const shouldCollapseSidebar = isGameActive || location.pathname.startsWith("/game");
  const syncSidebar = useEffectEvent((collapse: boolean) => {
    setSidebarCollapsed(collapse);
  });
  useEffect(() => {
    syncSidebar(shouldCollapseSidebar);
  }, [shouldCollapseSidebar]);

  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col">
      <StatusBanner />
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <IronsmithUnsupportedDeckModal />
      {!isDesktop && (
        <header
          className={cn(
            "flex items-center gap-2 border-b bg-background px-3 py-2 pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)]",
            hideNavChrome && "hidden",
          )}
        >
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <ManaBrewLogo size={28} className="rounded-lg shrink-0" />
          <span className="text-sm font-semibold tracking-tight">Manabrew</span>
        </header>
      )}

      {!isDesktop && (
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="p-0 w-64">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>
      )}

      <div className="flex flex-1 min-h-0">
        {isDesktop && (
          <div
            className={cn(
              "h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out",
              sidebarCollapsed ? "w-0" : "w-56 lg:w-60",
            )}
          >
            <Sidebar />
          </div>
        )}
        <div className="relative flex-1 min-w-0">
          {isDesktop && (
            <div
              className={cn(
                "absolute left-0 top-1/2 -translate-y-1/2 z-30 group",
                hideNavChrome && "hidden",
              )}
            >
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  "h-24 w-4 rounded-r-md rounded-l-none border border-l-0 border-border bg-card/90 px-0",
                  "translate-x-[-9px] group-hover:translate-x-0 group-hover:w-6 group-hover:h-28 transition-all duration-150",
                  "hover:bg-card",
                )}
                onClick={toggleSidebar}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronLeft className="h-3 w-3" />
                )}
              </Button>
            </div>
          )}
          <main className={cn("h-full overflow-auto", isImmersiveRoute && "!p-0 !overflow-hidden")}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
