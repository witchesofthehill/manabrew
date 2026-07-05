import { ArrowDownToLine, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { installDesktopUpdate } from "@/hooks/useDesktopUpdater";
import { useDesktopUpdateStore } from "@/stores/useDesktopUpdateStore";

export function SidebarUpdate() {
  const phase = useDesktopUpdateStore((s) => s.phase);
  const version = useDesktopUpdateStore((s) => s.version);
  const progress = useDesktopUpdateStore((s) => s.progress);
  const calloutDismissed = useDesktopUpdateStore((s) => s.calloutDismissed);
  const dismissCallout = useDesktopUpdateStore((s) => s.dismissCallout);

  if (phase === "idle" || !version) return null;

  const downloading = phase === "downloading";
  const downloadLabel = progress == null ? "Downloading…" : `Downloading… ${progress}%`;

  if (calloutDismissed) {
    return (
      <div className="px-3 py-2">
        <Button
          variant="ghost"
          disabled={downloading}
          onClick={() => void installDesktopUpdate()}
          className="w-full justify-start whitespace-nowrap rounded-lg text-primary animate-update-glow hover:text-primary"
        >
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <ArrowDownToLine className="mr-2 h-4 w-4 shrink-0" />
          )}
          {downloading ? downloadLabel : `Update to ${version}`}
        </Button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="rounded-lg border border-primary/50 bg-primary/10 p-3 animate-update-glow">
        <div className="mb-1 flex items-center gap-2">
          <ArrowDownToLine className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1 text-sm font-semibold">Update available</span>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={dismissCallout}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          Manabrew {version} is ready to install.
        </p>
        <Button
          size="sm"
          className="w-full"
          disabled={downloading}
          onClick={() => void installDesktopUpdate()}
        >
          {downloading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {downloading ? downloadLabel : "Install & restart"}
        </Button>
      </div>
    </div>
  );
}
