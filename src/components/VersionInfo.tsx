import { useState } from "react";
import { ArrowDownToLine, CircleCheck, Loader2, RefreshCw, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_VERSION } from "@/lib/constants";
import { getPlatformType } from "@/platform";
import { checkForDesktopUpdate, installDesktopUpdate } from "@/hooks/useDesktopUpdater";
import { useDesktopUpdateStore } from "@/stores/useDesktopUpdateStore";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
type CheckState = "idle" | "checking" | "latest" | "error";
export function VersionInfo() {
  const phase = useDesktopUpdateStore((s) => s.phase);
  const version = useDesktopUpdateStore((s) => s.version);
  const progress = useDesktopUpdateStore((s) => s.progress);
  const [check, setCheck] = useState<CheckState>("idle");
  async function runCheck() {
    setCheck("checking");
    try {
      setCheck((await checkForDesktopUpdate()) ? "idle" : "latest");
    } catch (err) {
      console.warn("[Updater] check failed", err);
      setCheck("error");
    }
  }
  const downloading = phase === "downloading";
  const downloadLabel =
    progress == null ? i18n._(msg`Downloading\u2026`) : i18n._(msg`Downloading… ${progress}%`);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/40 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Tag className="size-4" />
        </span>
        <div className="leading-tight">
          <span className="block text-sm font-semibold text-foreground">
            <Trans>Manabrew</Trans>
          </span>
          <span className="block text-xs text-muted-foreground">
            <Trans>Version {APP_VERSION}</Trans>
          </span>
        </div>
      </div>

      {getPlatformType() === "tauri" &&
        (phase !== "idle" && version ? (
          <Button
            size="sm"
            disabled={downloading}
            onClick={() => void installDesktopUpdate()}
            className="animate-update-glow"
          >
            {downloading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <ArrowDownToLine className="mr-2 size-4" />
            )}
            {downloading ? downloadLabel : i18n._(msg`Update to ${version}`)}
          </Button>
        ) : check === "latest" ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Trans>
              <CircleCheck className="size-4 text-primary" />
              You&apos;re on latest
            </Trans>
          </span>
        ) : (
          <div className="flex items-center gap-2">
            {check === "error" && (
              <span className="text-xs text-muted-foreground">
                <Trans>Couldn&apos;t reach the update server</Trans>
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={check === "checking"}
              onClick={() => void runCheck()}
            >
              {check === "checking" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              {check === "checking" ? i18n._(msg`Checking\u2026`) : i18n._(msg`Check for updates`)}
            </Button>
          </div>
        ))}
    </div>
  );
}
