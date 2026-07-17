import { ArrowDownToLine, ArrowLeft, Loader2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { installDesktopUpdate } from "@/hooks/useDesktopUpdater";
import { ROUTES } from "@/lib/constants";
import { useDesktopUpdateStore } from "@/stores/useDesktopUpdateStore";
import { ManaBrewLogo } from "./ManaBrewLogo";

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const phase = useDesktopUpdateStore((s) => s.phase);
  const version = useDesktopUpdateStore((s) => s.version);
  const progress = useDesktopUpdateStore((s) => s.progress);

  const downloading = phase === "downloading";
  const updateLabel = downloading
    ? progress == null
      ? "Downloading…"
      : `Downloading… ${progress}%`
    : `Update to ${version}`;

  function goBack() {
    if (location.key === "default") {
      navigate(ROUTES.PLAY);
    } else {
      navigate(-1);
    }
  }

  return (
    <header className="flex items-center gap-2 border-b border-border/70 bg-background/80 py-2 pl-[calc(var(--safe-area-inset-left)+0.75rem)] pr-[calc(var(--safe-area-inset-right)+0.75rem)] pt-[calc(var(--safe-area-inset-top)+0.5rem)] backdrop-blur-md">
      {location.pathname !== ROUTES.PLAY && (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={goBack}
          title="Back"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="sr-only">Back</span>
        </Button>
      )}
      <Link
        to={ROUTES.PLAY}
        aria-label="Manabrew Home"
        className="relative flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']"
      >
        <ManaBrewLogo size={28} className="shrink-0 rounded-lg" />
        <span className="truncate text-sm font-semibold tracking-tight">Manabrew</span>
      </Link>
      {phase !== "idle" && version && (
        <Button
          size="sm"
          disabled={downloading}
          onClick={() => void installDesktopUpdate()}
          className="ml-auto animate-update-glow"
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
    </header>
  );
}
