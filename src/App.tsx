import { RouterProvider } from "react-router-dom";
import { msg } from "@lingui/core/macro";
import { ThemeProvider } from "next-themes";
import { I18nProvider, useLingui } from "@lingui/react";
import { router } from "@/router";
import { Toaster } from "@/components/ui/sonner";
import { DebugLogOverlay } from "@/components/dev/DebugLogOverlay";
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
import { i18n } from "@/i18n/i18n";
// Importing the store wires the `app:init` event subscription before App mounts,
// so the gate observes every boot stage from the initialization effect.
import "@/stores/useAppInitStore";

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
          i18n._(msg`In-browser engines are unavailable. Forge games will use a hosted engine.`),
          details,
        );
        return;
      }
      console.error(
        i18n._(
          msg`Deployment is missing cross-origin isolation. SharedArrayBuffer game flow will fail.`,
        ),
        details,
      );
      toast.error(
        platform === "tauri"
          ? i18n._(
              msg`This desktop build is missing required isolation headers (COOP/COEP). The game engine cannot start.`,
            )
          : i18n._(
              msg`Web deployment is missing required isolation headers. Ask infra to enable COOP/COEP through the Twingate/SSO path.`,
            ),
        { duration: 12000 },
      );
      return;
    }

    console.info(i18n._(msg`Cross-origin isolation is enabled.`));
  }, []);

  const deckMigrationError = useDeckStore((s) => s.migrationError);
  useEffect(() => {
    if (!deckMigrationError) return;
    toast.error(
      i18n._(
        msg`Couldn't load your saved decks — they're left untouched on disk. Please contact the developer.`,
      ),
      { duration: Infinity },
    );
  }, [deckMigrationError]);

  return null;
}
function LocalizedApplication({ devToolsEnabled }: { devToolsEnabled: boolean }) {
  useLingui();

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ThemeApplicator>
        <TooltipProvider delayDuration={120} skipDelayDuration={300}>
          <PlatformRuntimeChecks />
          <AppInitGate>
            <RouterProvider router={router} />
          </AppInitGate>
          <Toaster />
          {import.meta.env.VITE_STAGING_TOOLS === "1" && <DebugLogOverlay />}
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

function App() {
  const devToolsEnabled = useGameDevStore((s) => s.devToolsEnabled);
  useEffect(() => {
    void initApp();
  }, []);

  return (
    <I18nProvider i18n={i18n}>
      <LocalizedApplication devToolsEnabled={devToolsEnabled} />
    </I18nProvider>
  );
}

export default App;
