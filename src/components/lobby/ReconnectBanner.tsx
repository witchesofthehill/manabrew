import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/useServerStore";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface ReconnectBannerProps {
  className?: string;
}
export function ReconnectBanner({ className }: ReconnectBannerProps) {
  const reconnect = useServerStore((s) => s.reconnect);
  if (reconnect.phase === "idle") return null;
  const message =
    reconnect.reason === "server-shutdown"
      ? i18n._(msg`Server updating, reconnecting\u2026`)
      : i18n._(msg`Reconnecting… (attempt ${reconnect.attempt})`);
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-md border bg-warning/10 text-warning border-warning/30 text-xs",
        className,
      )}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{message}</span>
    </div>
  );
}
