import { LoaderCircle, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/useServerStore";

interface RelayConnectionStatusProps {
  className?: string;
}

export function RelayConnectionStatus({ className }: RelayConnectionStatusProps) {
  const connected = useServerStore((state) => state.connected);
  const connecting = useServerStore((state) => state.connecting);
  const reconnect = useServerStore((state) => state.reconnect);

  const isReconnecting = reconnect.phase === "reconnecting";
  const reconnectFailed = reconnect.phase === "failed";
  const isConnecting = connecting && !isReconnecting;
  const isConnected = connected && reconnect.phase === "idle";
  const label = isReconnecting
    ? "Reconnecting"
    : isConnecting
      ? "Connecting"
      : isConnected
        ? "Connected"
        : "Offline";
  const detail = reconnectFailed
    ? "Relay reconnection failed"
    : isReconnecting
      ? reconnect.reason === "server-shutdown"
        ? "Relay is updating and reconnecting"
        : `Reconnecting to relay, attempt ${reconnect.attempt}`
      : isConnecting
        ? "Connecting to relay"
        : isConnected
          ? "Relay connection is active"
          : "Not connected to relay";
  const Icon = isConnected ? Wifi : isConnecting || isReconnecting ? LoaderCircle : WifiOff;

  return (
    <div
      role="status"
      aria-live="polite"
      title={detail}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        isConnected && "border-primary/30 bg-primary/10 text-primary",
        (isConnecting || isReconnecting) && "border-warning/30 bg-warning/10 text-warning",
        !isConnected &&
          !isConnecting &&
          !isReconnecting &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", (isConnecting || isReconnecting) && "animate-spin")} />
      <span>Relay: {label}</span>
    </div>
  );
}
