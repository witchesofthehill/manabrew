import { ArrowDownToLine, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { installDesktopUpdate } from "@/hooks/useDesktopUpdater";
import { useDesktopUpdateStore } from "@/stores/useDesktopUpdateStore";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export function UpdateCallout() {
  const phase = useDesktopUpdateStore((s) => s.phase);
  const version = useDesktopUpdateStore((s) => s.version);
  const progress = useDesktopUpdateStore((s) => s.progress);
  const calloutDismissed = useDesktopUpdateStore((s) => s.calloutDismissed);
  const dismissCallout = useDesktopUpdateStore((s) => s.dismissCallout);
  if (phase === "idle" || !version || calloutDismissed) return null;
  const downloading = phase === "downloading";
  const downloadLabel =
    progress == null ? i18n._(msg`Downloading\u2026`) : i18n._(msg`Downloading… ${progress}%`);
  return (
    <div className="rounded-lg border border-primary/50 bg-primary/10 p-3 motion-safe:animate-update-glow sm:flex sm:items-center sm:gap-4 sm:p-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ArrowDownToLine className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            <Trans>Update available</Trans>
          </p>
          <p className="text-xs text-muted-foreground">
            <Trans>Manabrew {version} is ready to install.</Trans>
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1 h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground sm:hidden"
          onClick={dismissCallout}
          aria-label={i18n._(msg`Dismiss update`)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-1 sm:mt-0 sm:shrink-0">
        <Button
          size="sm"
          className="w-full sm:w-auto"
          disabled={downloading}
          onClick={() => void installDesktopUpdate()}
        >
          {downloading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {downloading ? downloadLabel : i18n._(msg`Install & restart`)}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground sm:inline-flex"
          onClick={dismissCallout}
          aria-label={i18n._(msg`Dismiss update`)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
