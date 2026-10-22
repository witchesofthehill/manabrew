import { ArrowDownToLine, Loader2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { installDesktopUpdate } from "@/hooks/useDesktopUpdater";
import { ROUTES } from "@/lib/constants";
import { useDesktopUpdateStore } from "@/stores/useDesktopUpdateStore";
import { AccountMenu } from "./AccountMenu";
import { ManaBrewLogo } from "./ManaBrewLogo";
import { NavSheet } from "./NavSheet";
import { TopBarNav } from "./TopBarNav";
import type { TopBarOverride } from "./TopBarOverride";
function normalizePathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}
function getRouteTitle(pathname: string, search: string): string | null {
  pathname = normalizePathname(pathname);
  if (pathname === ROUTES.PLAY) return null;
  if (pathname === ROUTES.PLAY_OFFLINE_CONSTRUCTED) {
    return `Play Offline`;
  }
  if (pathname === ROUTES.PLAY_OFFLINE_LIMITED) {
    return `Play Offline`;
  }
  if (pathname.startsWith(`${ROUTES.PLAY_DECK}/`)) {
    return `Play Deck`;
  }
  if (pathname === ROUTES.LOBBY) {
    return `Multiplayer`;
  }
  if (pathname === ROUTES.SEARCH) {
    return `Card Search`;
  }
  if (pathname === ROUTES.DECK_EDITOR) {
    return new URLSearchParams(search).has("deck") ? `Deck Editor` : `My Decks`;
  }
  if (pathname === ROUTES.MY_COLLECTION) {
    return `My Collection`;
  }
  if (pathname === ROUTES.HUB_TOP) {
    return `Top Decks`;
  }
  if (pathname === ROUTES.HUB) {
    return `Community`;
  }
  if (pathname === `${ROUTES.DRAFT}/multiplayer`) {
    return `Multiplayer Draft`;
  }
  if (pathname.startsWith(`${ROUTES.DRAFT}/`)) {
    return `Booster Draft`;
  }
  if (pathname === `${ROUTES.SEALED}/multiplayer`) {
    return `Sealed Deck Build`;
  }
  if (pathname.startsWith(`${ROUTES.SEALED}/`)) {
    return `Sealed`;
  }
  if (pathname.startsWith(`${ROUTES.WINSTON}/`)) {
    return `Winston Draft`;
  }
  if (pathname.startsWith(`${ROUTES.GAUNTLET}/`)) {
    return `Gauntlet`;
  }
  if (pathname === ROUTES.COMPANION) {
    return `Life Tracker`;
  }
  if (pathname === ROUTES.SETTINGS) {
    return `Preferences`;
  }
  if (pathname === ROUTES.ABOUT) {
    return `About Manabrew`;
  }
  if (pathname === ROUTES.DESIGN_SYSTEM) {
    return `Design System`;
  }
  if (pathname === "/card-mock") {
    return "Card lab";
  }
  return null;
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
  const title = override?.title ?? getRouteTitle(location.pathname, location.search);
  // AppShell hides this bar while the board is shown, so a live game never
  // reaches here except from another route, where it must stay navigable.
  const navigationDisabled = override?.navigationDisabled === true;

  const downloading = phase === "downloading";
  const updateLabel = downloading
    ? progress == null
      ? `Downloading…`
      : `Downloading… ${progress}%`
    : version
      ? `Update to ${version}`
      : "";
  function goHome() {
    if (override?.onHome) {
      override.onHome();
    } else {
      navigate(ROUTES.PLAY);
    }
  }
  return (
    <header className="flex min-w-0 items-center gap-2 border-b border-border/70 bg-card py-2 pl-[calc(var(--safe-area-inset-left)+1rem)] pr-[calc(var(--safe-area-inset-right)+1rem)] pt-[calc(var(--safe-area-inset-top)+0.5rem)] sm:pl-[calc(var(--safe-area-inset-left)+1.5rem)] sm:pr-[calc(var(--safe-area-inset-right)+1.5rem)] lg:pl-[calc(var(--safe-area-inset-left)+2rem)] lg:pr-[calc(var(--safe-area-inset-right)+2rem)]">
      <button
        type="button"
        onClick={goHome}
        aria-label={`Manabrew Home`}
        className="group relative flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-transparent px-0.5 py-0 motion-safe:transition-[background-color,border-color,box-shadow] hover:border-primary/30 hover:bg-primary/10 hover:shadow-sm focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ManaBrewLogo decorative height={40} className="hidden shrink-0 sm:block" />
        <ManaBrewLogo decorative variant="symbol" height={36} className="shrink-0 sm:hidden" />
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
            variant="secondary"
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
              {downloading && progress != null ? `${progress}%` : `Update`}
            </span>
          </Button>
        )}
        <AccountMenu disabled={navigationDisabled} />
      </div>
    </header>
  );
}
