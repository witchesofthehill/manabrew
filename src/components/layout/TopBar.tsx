import { ArrowDownToLine, ArrowLeft, CircleUserRound, Loader2, Settings } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { isFeatureEnabled } from "@/featureFlags";
import { installDesktopUpdate } from "@/hooks/useDesktopUpdater";
import { ROUTES } from "@/lib/constants";
import { useAuthStore } from "@/stores/useAuthStore";
import { useDesktopUpdateStore } from "@/stores/useDesktopUpdateStore";
import { useGameStore } from "@/stores/useGameStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { ManaBrewLogo } from "./ManaBrewLogo";
import { NavSheet } from "./NavSheet";
import { TopBarNav } from "./TopBarNav";
import type { TopBarOverride } from "./TopBarOverride";

interface RouteChrome {
  title: string | null;
  fallback: string;
}

function normalizePathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function getRouteChrome(pathname: string, search: string): RouteChrome {
  pathname = normalizePathname(pathname);
  if (pathname === ROUTES.PLAY) return { title: null, fallback: ROUTES.PLAY };
  if (pathname === ROUTES.PLAY_OFFLINE_CONSTRUCTED) {
    return { title: "Play Offline", fallback: ROUTES.PLAY };
  }
  if (pathname === ROUTES.PLAY_OFFLINE_LIMITED) {
    return { title: "Play Offline", fallback: ROUTES.PLAY };
  }
  if (pathname.startsWith(`${ROUTES.PLAY_DECK}/`)) {
    return { title: "Play Deck", fallback: ROUTES.PLAY };
  }
  if (pathname === ROUTES.LOBBY) return { title: "Multiplayer", fallback: ROUTES.PLAY };
  if (pathname === ROUTES.SEARCH) return { title: "Card Search", fallback: ROUTES.PLAY };
  if (pathname === ROUTES.DECK_EDITOR) {
    return {
      title: new URLSearchParams(search).has("deck") ? "Deck Editor" : "My Decks",
      fallback: ROUTES.PLAY,
    };
  }
  if (pathname === ROUTES.HUB) return { title: "Deck Hub", fallback: ROUTES.PLAY };
  if (pathname === `${ROUTES.DRAFT}/multiplayer`) {
    return { title: "Multiplayer Draft", fallback: ROUTES.LOBBY };
  }
  if (pathname.startsWith(`${ROUTES.DRAFT}/`)) {
    return { title: "Booster Draft", fallback: ROUTES.PLAY_OFFLINE_LIMITED };
  }
  if (pathname === `${ROUTES.SEALED}/multiplayer`) {
    return { title: "Sealed Deck Build", fallback: ROUTES.LOBBY };
  }
  if (pathname.startsWith(`${ROUTES.SEALED}/`)) {
    return { title: "Sealed", fallback: ROUTES.PLAY_OFFLINE_LIMITED };
  }
  if (pathname.startsWith(`${ROUTES.WINSTON}/`)) {
    return { title: "Winston Draft", fallback: ROUTES.PLAY_OFFLINE_LIMITED };
  }
  if (pathname.startsWith(`${ROUTES.GAUNTLET}/`)) {
    return { title: "Gauntlet", fallback: ROUTES.PLAY_OFFLINE_LIMITED };
  }
  if (pathname === ROUTES.COMPANION) return { title: "Life Tracker", fallback: ROUTES.PLAY };
  if (pathname === ROUTES.SETTINGS) return { title: "Preferences", fallback: ROUTES.PLAY };
  if (pathname === ROUTES.ABOUT) return { title: "About Manabrew", fallback: ROUTES.PLAY };
  if (pathname === ROUTES.DESIGN_SYSTEM) {
    return { title: "Design System", fallback: ROUTES.PLAY };
  }
  if (pathname === "/card-mock") return { title: "Card Face Gallery", fallback: ROUTES.PLAY };
  return { title: null, fallback: ROUTES.PLAY };
}

interface TopBarProps {
  override?: TopBarOverride;
}

export function TopBar({ override }: TopBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const phase = useDesktopUpdateStore((s) => s.phase);
  const version = useDesktopUpdateStore((s) => s.version);
  const progress = useDesktopUpdateStore((s) => s.progress);
  const isGameActive = useGameStore((s) => s.isGameActive);
  const account = useAuthStore((s) => s.account);
  const authStatus = useAuthStore((s) => s.status);
  const showSignIn = useSignInDialog((s) => s.show);
  const signedInAccount = authStatus === "signedIn" ? account : null;
  const routeChrome = getRouteChrome(location.pathname, location.search);
  const title = override?.title ?? routeChrome.title;
  const isPlayHome = normalizePathname(location.pathname) === ROUTES.PLAY;
  const isSettingsRoute = normalizePathname(location.pathname) === ROUTES.SETTINGS;
  const navigationDisabled = isGameActive || override?.navigationDisabled === true;

  const downloading = phase === "downloading";
  const updateLabel = downloading
    ? progress == null
      ? "Downloading…"
      : `Downloading… ${progress}%`
    : `Update to ${version}`;

  function goBack() {
    if (isGameActive) return;
    if (override?.onBack) {
      override.onBack();
      return;
    }
    const routeState = location.state;
    if (
      routeState &&
      typeof routeState === "object" &&
      "topBarBackTo" in routeState &&
      typeof routeState.topBarBackTo === "string"
    ) {
      navigate(routeState.topBarBackTo, { replace: true });
      return;
    }
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) {
      navigate(-1);
    } else {
      navigate(routeChrome.fallback);
    }
  }

  function goHome() {
    if (isGameActive) return;
    if (override?.onHome) {
      override.onHome();
    } else {
      navigate(ROUTES.PLAY);
    }
  }

  return (
    <header className="flex min-w-0 items-center gap-2 border-b border-border/70 bg-background/80 py-2 pl-[calc(var(--safe-area-inset-left)+1rem)] pr-[calc(var(--safe-area-inset-right)+1rem)] pt-[calc(var(--safe-area-inset-top)+0.5rem)] backdrop-blur-md sm:pl-[calc(var(--safe-area-inset-left)+1.5rem)] sm:pr-[calc(var(--safe-area-inset-right)+1.5rem)] lg:pl-[calc(var(--safe-area-inset-left)+2rem)] lg:pr-[calc(var(--safe-area-inset-right)+2rem)]">
      {!isPlayHome && (
        <Button
          size="icon"
          variant="ghost"
          className="group h-8 w-8 shrink-0 border border-transparent motion-safe:transition-[background-color,border-color,color,box-shadow] hover:border-primary/30 hover:bg-primary/10 hover:text-primary hover:shadow-sm"
          disabled={isGameActive}
          onClick={goBack}
          title="Back"
        >
          <ArrowLeft className="h-5 w-5 motion-safe:transition-transform motion-safe:group-hover:-translate-x-0.5" />
          <span className="sr-only">Back</span>
        </Button>
      )}
      <button
        type="button"
        disabled={isGameActive}
        onClick={goHome}
        aria-label="Manabrew Home"
        className="group relative flex shrink-0 items-center gap-2 rounded-xl border border-transparent p-0.5 motion-safe:transition-[background-color,border-color,box-shadow] hover:border-primary/30 hover:bg-primary/10 hover:shadow-sm focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']"
      >
        <ManaBrewLogo
          size={36}
          className="shrink-0 rounded-lg motion-safe:transition-transform motion-safe:group-hover:scale-105"
        />
      </button>
      {title && (
        <>
          <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
          <h1 className="min-w-0 truncate text-sm font-medium" title={title}>
            {title}
          </h1>
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <TopBarNav
          key={navigationDisabled ? "disabled-nav" : "primary-nav"}
          disabled={navigationDisabled}
        />
        <NavSheet
          key={navigationDisabled ? "disabled-sheet" : "primary-sheet"}
          disabled={navigationDisabled}
        />
        {phase !== "idle" && version && (
          <Button
            size="sm"
            disabled={downloading || navigationDisabled}
            onClick={() => void installDesktopUpdate()}
            className="shrink-0 animate-update-glow"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin min-[400px]:mr-2" />
            ) : (
              <ArrowDownToLine className="h-4 w-4 min-[400px]:mr-2" />
            )}
            <span className="hidden min-[400px]:inline">{updateLabel}</span>
            <span className="min-[400px]:hidden">
              {downloading && progress != null ? `${progress}%` : "Update"}
            </span>
          </Button>
        )}
        {isFeatureEnabled("accounts") && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={navigationDisabled}
            title={signedInAccount ? `@${signedInAccount.handle}` : "Sign in"}
            onClick={() =>
              signedInAccount
                ? navigate(ROUTES.SETTINGS, { state: { settingsTab: "account" } })
                : showSignIn()
            }
          >
            <CircleUserRound className="h-4 w-4" />
            <span className="sr-only">
              {signedInAccount ? `@${signedInAccount.handle}` : "Sign in"}
            </span>
          </Button>
        )}
        <Button
          size="icon"
          variant={isSettingsRoute ? "secondary" : "ghost"}
          className="h-8 w-8"
          disabled={navigationDisabled}
          title={
            navigationDisabled ? "Preferences are unavailable during this session" : "Preferences"
          }
          onClick={() => navigate(ROUTES.SETTINGS)}
        >
          <Settings className="h-4 w-4" />
          <span className="sr-only">Preferences</span>
        </Button>
      </div>
    </header>
  );
}
