import { RouterProvider } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { router } from "@/router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppInitGate } from "@/components/AppInitGate";
import { useTheme } from "@/hooks/useTheme";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { lazy, Suspense, useEffect } from "react";
import { toast } from "sonner";
import { getPlatformType } from "@/platform";
import { initApp } from "@/lib/appInit";
import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
// Importing the store wires the `app:init` event subscription at module load —
// earlier than App mounts, and earlier than the `initApp()` below — so the gate
// observes every boot stage from the first event.
import "@/stores/useAppInitStore";

void initApp();
const DevToolsPanel = import.meta.env.DEV
  ? lazy(() => import("@/components/dev/DevToolsPanel").then((m) => ({ default: m.DevToolsPanel })))
  : () => null;

function ThemeApplicator({ children }: { children: React.ReactNode }) {
  useTheme();
  return <>{children}</>;
}

function PlatformRuntimeChecks() {
  useEffect(() => {
    if (window.location.pathname.startsWith("/companion")) return;

    const isolated = window.crossOriginIsolated;
    const hasSharedArrayBuffer = typeof window.SharedArrayBuffer !== "undefined";

    if (!isolated || !hasSharedArrayBuffer) {
      const platform = getPlatformType();
      const hostedFallback = platform === "web" && isHostedEngineAvailable();
      const details = {
        platform,
        crossOriginIsolated: isolated,
        hasSharedArrayBuffer,
      };
      if (hostedFallback) {
        console.warn(
          "[Runtime] In-browser engines are unavailable. Forge games will use a hosted engine.",
          details,
        );
        return;
      }
      console.error(
        "[Runtime] Deployment is missing cross-origin isolation. SharedArrayBuffer game flow will fail.",
        details,
      );
      toast.error(
        platform === "tauri"
          ? "This desktop build is missing required isolation headers (COOP/COEP). The game engine cannot start."
          : "Web deployment is missing required isolation headers. Ask infra to enable COOP/COEP through the Twingate/SSO path.",
        { duration: 12000 },
      );
      return;
    }

    console.info("[Runtime] Cross-origin isolation is enabled.");
  }, []);

  const deckMigrationError = useDeckStore((s) => s.migrationError);
  useEffect(() => {
    if (!deckMigrationError) return;
    toast.error(
      "Couldn't load your saved decks — they're left untouched on disk. Please contact the developer.",
      { duration: Infinity },
    );
  }, [deckMigrationError]);

  return null;
}

function App() {
  const devToolsEnabled = useGameDevStore((s) => s.devToolsEnabled);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ThemeApplicator>
        <TooltipProvider delayDuration={120} skipDelayDuration={300}>
          <PlatformRuntimeChecks />
          <AppInitGate>
            <RouterProvider router={router} />
          </AppInitGate>
          <Toaster />
          {import.meta.env.DEV && devToolsEnabled && (
            <Suspense>
              <DevToolsPanel />
            </Suspense>
          )}
        </TooltipProvider>
      </ThemeApplicator>
    </ThemeProvider>
  );
}

export default App;
