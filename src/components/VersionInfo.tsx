import { CircleCheck, Download, Loader2, RefreshCw, Tag } from "lucide-react";
import { useLatestRelease } from "@/hooks/useLatestRelease";
import { APP_VERSION, GITHUB_RELEASES_URL } from "@/lib/constants";

export function VersionInfo() {
  const { status, latest, check } = useLatestRelease();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/40 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Tag className="size-4" />
        </span>
        <div className="leading-tight">
          <span className="block text-sm font-semibold text-foreground">Manabrew</span>
          <span className="block text-xs text-muted-foreground">Version {APP_VERSION}</span>
        </div>
      </div>

      {status === "checking" && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Checking for updates…
        </span>
      )}

      {status === "current" && (
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <CircleCheck className="size-4 text-primary" />
          Up to date
        </span>
      )}

      {status === "outdated" && latest && (
        <a
          href={latest.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:border-primary/60 hover:bg-primary/25"
        >
          <Download className="size-3.5" />
          Update available — {latest.version}
        </a>
      )}

      {status === "error" && (
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Releases on GitHub
          </a>
          <button
            type="button"
            onClick={check}
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
            Retry
          </button>
        </span>
      )}
    </div>
  );
}
