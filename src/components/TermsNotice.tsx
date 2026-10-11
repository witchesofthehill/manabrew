import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAcknowledgement } from "@/hooks/useAcknowledgement";
import { PRIVACY_URL, TERMS_URL, TERMS_VERSION } from "@/lib/terms";

const TERMS_STORAGE_KEY = "manabrew.termsAcceptance";

/**
 * Non-blocking notice that replaced the first-run terms gate. Play never
 * waits on it. Account creation keeps its own explicit agreement checkbox.
 */
export function TermsNotice() {
  const { record, accepted, accept } = useAcknowledgement(TERMS_STORAGE_KEY, TERMS_VERSION);
  if (accepted) return null;
  const updated = record !== null;
  const link = "font-medium text-foreground underline underline-offset-2";
  return (
    <div
      role="region"
      aria-label={`Terms notice`}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,var(--safe-area-inset-bottom))] motion-safe:animate-onboard-fade-up"
    >
      <div className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-lg border border-border/60 bg-background/90 py-2 pl-4 pr-2 text-xs text-muted-foreground shadow-lg backdrop-blur-md">
        <p className="min-w-0 flex-1">
          {updated ? `Our terms have changed. ` : null}
          By using Manabrew you agree to the{" "}
          <a href={TERMS_URL} target="_blank" rel="noreferrer" className={link}>
            terms
          </a>{" "}
          and the{" "}
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className={link}>
            privacy policy
          </a>
          .
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={accept}
          aria-label={`Dismiss terms notice`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
