import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useServerStore } from "@/stores/useServerStore";
import { useGameStore } from "@/stores/useGameStore";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDragToggle } from "@/hooks/useDragToggle";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ManaBrewLogo } from "./ManaBrewLogo";

// Tailwind's default `md` breakpoint. Kept in sync with utility classes
// like `md:hidden` / `hidden md:flex` so the JS gate matches the CSS.
const DESKTOP_QUERY = "(min-width: 768px)";

export function AppShell() {
  // Render only the active layout branch. Previously both <Outlet /> trees
  // were mounted and CSS hid one — every Pixi canvas inside (game scene,
  // arrows overlay, phase strip) was therefore allocated twice and
  // doubled the WebGL context count, eventually blowing past the
  // browser's per-tab cap.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const sidebarRef = usePanelRef();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const setupListeners = useServerStore((s) => s.setupListeners);
  const location = useLocation();
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

  function toggleSidebar() {
    const panel = sidebarRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setSidebarCollapsed(false);
    } else {
      panel.collapse();
      setSidebarCollapsed(true);
    }
  }

  const expandSidebar = useCallback(() => {
    const panel = sidebarRef.current;
    if (panel?.isCollapsed()) {
      panel.expand();
      setSidebarCollapsed(false);
    }
  }, [sidebarRef]);

  const collapseSidebar = useCallback(() => {
    const panel = sidebarRef.current;
    if (panel && !panel.isCollapsed()) {
      panel.collapse();
      setSidebarCollapsed(true);
    }
  }, [sidebarRef]);

  const onDragMouseDown = useDragToggle(expandSidebar, collapseSidebar, "right");

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
    if (collapse) collapseSidebar();
    else expandSidebar();
  });
  useEffect(() => {
    syncSidebar(shouldCollapseSidebar);
  }, [shouldCollapseSidebar]);

  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col">
      {!isDesktop && (
        <>
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
            <span className="text-sm font-semibold tracking-tight">ManaBrew</span>
          </header>

          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent side="left" className="p-0 w-64">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Sidebar onNavigate={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>

          <main className={cn("flex-1 overflow-auto", isImmersiveRoute && "!p-0 !overflow-hidden")}>
            <Outlet />
          </main>
        </>
      )}

      {isDesktop && (
        <div className="flex flex-1 min-h-0">
          <ResizablePanelGroup orientation="horizontal" className="relative h-full">
            <ResizablePanel
              panelRef={sidebarRef}
              defaultSize={260}
              minSize={14}
              maxSize={300}
              collapsible
              collapsedSize={0}
            >
              <Sidebar />
            </ResizablePanel>
            <ResizableHandle withHandle className={cn(hideNavChrome && "hidden")} />
            <ResizablePanel minSize={40} className="relative">
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
                  onMouseDown={onDragMouseDown}
                  title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {sidebarCollapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronLeft className="h-3 w-3" />
                  )}
                </Button>
              </div>
              <main
                className={cn("h-full overflow-auto", isImmersiveRoute && "!p-0 !overflow-hidden")}
              >
                <Outlet />
              </main>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
    </div>
  );
}
