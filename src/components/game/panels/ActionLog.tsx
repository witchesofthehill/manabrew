import { cn } from "@/lib/utils";
import type { GameLogEntryType, GameLogEntry } from "@/types/gameLog";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { useLongPressPreview } from "@/hooks/useLongPressPreview";

interface ActionLogProps {
  gameLog: GameLogEntry[];
  resolveCardName: (cardId: string) => string;
  resolvePlayerName: (playerId: string) => string;
  onHoverLogCard: (
    cardId: string | null,
    event?: React.MouseEvent,
    options?: {
      useAnchor?: boolean;
      placement?: "auto" | "top-center";
      anchorOverride?: DOMRect;
      useDelay?: boolean;
    },
  ) => void;
}

export function ActionLog({
  gameLog,
  resolveCardName,
  resolvePlayerName,
  onHoverLogCard,
}: ActionLogProps) {
  const visibleLog = gameLog.filter((entry) => entry.entryType !== "rule");
  const themeColors = useTheme().gameTheme;
  const longPress = useLongPressPreview<string>({
    resolve: (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-log-card-id]");
      return el?.dataset.logCardId ? { item: el.dataset.logCardId, anchor: el } : null;
    },
    show: (cardId, rect) =>
      onHoverLogCard(cardId, undefined, { useAnchor: true, anchorOverride: rect, useDelay: false }),
    hide: () => onHoverLogCard(null),
  });
  const priorityColor = themeColors.activeAction.priority;
  const infoColor = themeColors.promptAction.defenseAction;

  const typeLabel: Record<GameLogEntryType, string> = {
    info: "INFO",
    action: "ACTION",
    stack: "STACK",
    priority: "PRIO",
    rule: "RULE",
    warning: "WARN",
  };

  const getStyleForType = (type: GameLogEntryType, message: string): { bg: string; fg: string } => {
    if (type === "stack" && /\bresolved?\b/i.test(message)) {
      return { bg: withAlpha(priorityColor, 0.12), fg: priorityColor };
    }
    if (/^TURN\b/i.test(message)) {
      return { bg: withAlpha(priorityColor, 0.12), fg: priorityColor };
    }

    switch (type) {
      case "action":
        return {
          bg: withAlpha(themeColors.promptAction.passAction, 0.12),
          fg: themeColors.promptAction.passAction,
        };
      case "stack":
        return { bg: withAlpha(priorityColor, 0.12), fg: priorityColor };
      case "priority":
        return { bg: withAlpha(priorityColor, 0.12), fg: priorityColor };
      case "warning":
        return {
          bg: withAlpha(themeColors.promptAction.attackAction, 0.12),
          fg: themeColors.promptAction.attackAction,
        };
      default:
        return { bg: withAlpha(themeColors.textMuted, 0.12), fg: themeColors.textMuted };
    }
  };

  const formatTs = (timestampMs: number) =>
    new Date(timestampMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  if (visibleLog.length === 0) {
    return (
      <div className="rounded-lg p-2.5 min-h-0 flex-1 flex flex-col bg-muted/20">
        <p className="text-xs font-semibold text-muted-foreground mb-2">Game Log</p>
        <p className="text-xs text-muted-foreground italic">No log entries yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg p-2.5 min-h-0 flex-1 flex flex-col bg-muted/20">
      <p className="text-xs font-semibold text-muted-foreground mb-2">Game Log</p>
      <div
        className="min-h-0 flex-1 overflow-y-auto text-xs text-muted-foreground flex flex-col-reverse pr-1"
        {...longPress}
      >
        {visibleLog
          .slice(-200)
          .reverse()
          .map((entry, i) => {
            const style = getStyleForType(entry.entryType, entry.message);
            return (
              <div
                key={i}
                className={cn(
                  "py-1 border-b border-border/40 last:border-b-0",
                  entry.entryType === "warning" && "text-warning font-semibold",
                )}
                data-log-card-id={entry.cardId ?? undefined}
                onPointerEnter={(e) => {
                  if (e.pointerType === "touch") return;
                  onHoverLogCard(entry.cardId ?? null, e, { useAnchor: true });
                }}
                onPointerLeave={(e) => {
                  if (e.pointerType === "touch") return;
                  onHoverLogCard(null);
                }}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className="px-1 py-0.5 rounded text-[10px] font-semibold"
                    style={{ backgroundColor: style.bg, color: style.fg }}
                  >
                    {entry.entryType === "stack" && /\bresolved?\b/i.test(entry.message)
                      ? "RESOLVE"
                      : /^TURN\b/i.test(entry.message)
                        ? "TURN"
                        : typeLabel[entry.entryType]}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80">
                    {formatTs(entry.timestampMs)}
                  </span>
                  {entry.playerId && (
                    <span className="text-[10px] text-muted-foreground/80">
                      {resolvePlayerName(entry.playerId)}
                    </span>
                  )}
                </div>
                {(entry.sourceCardId || entry.targetCardId) && (
                  <div className="flex items-center gap-1 mb-0.5">
                    {entry.sourceCardId && (
                      <span
                        className="px-1 py-0.5 rounded text-[10px] cursor-help"
                        style={{ backgroundColor: withAlpha(infoColor, 0.12), color: infoColor }}
                        data-log-card-id={entry.sourceCardId}
                        onPointerEnter={(e) => {
                          if (e.pointerType === "touch") return;
                          onHoverLogCard(entry.sourceCardId!, e, { useAnchor: true });
                        }}
                        onPointerLeave={(e) => {
                          if (e.pointerType === "touch") return;
                          onHoverLogCard(null);
                        }}
                      >
                        {resolveCardName(entry.sourceCardId)}
                      </span>
                    )}
                    {entry.targetCardId && (
                      <span
                        className="px-1 py-0.5 rounded text-[10px] cursor-help"
                        style={{ backgroundColor: withAlpha(infoColor, 0.12), color: infoColor }}
                        data-log-card-id={entry.targetCardId}
                        onPointerEnter={(e) => {
                          if (e.pointerType === "touch") return;
                          onHoverLogCard(entry.targetCardId!, e, { useAnchor: true });
                        }}
                        onPointerLeave={(e) => {
                          if (e.pointerType === "touch") return;
                          onHoverLogCard(null);
                        }}
                      >
                        {resolveCardName(entry.targetCardId)}
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={
                    entry.entryType === "warning" ? "whitespace-pre-wrap break-all" : undefined
                  }
                >
                  {entry.message}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
