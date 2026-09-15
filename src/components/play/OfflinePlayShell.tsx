import { useState, type ReactNode } from "react";
import { Boxes, ChevronDown, ChevronUp, Swords } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";

interface OfflinePlayShellProps {
  children: ReactNode | ((modeToggle: ReactNode) => ReactNode);
}

const TABS = [
  {
    to: ROUTES.PLAY_OFFLINE_CONSTRUCTED,
    label: "Constructed",
    hint: "Deck vs AI",
    icon: Swords,
  },
  {
    to: ROUTES.PLAY_OFFLINE_LIMITED,
    label: "Limited",
    hint: "Draft & sealed",
    icon: Boxes,
  },
];

export function OfflinePlayShell({ children }: OfflinePlayShellProps) {
  const location = useLocation();
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const compact = shortScreen && isTouch;

  const [modesExpanded, setModesExpanded] = useState(!compact);
  const compactCollapsed = compact && !modesExpanded;
  const activeTab = TABS.find(({ to }) => to === location.pathname) ?? TABS[0]!;
  const modeToggle = compact ? (
    <button
      type="button"
      aria-expanded={modesExpanded}
      aria-label={modesExpanded ? "Hide offline mode switcher" : "Show offline mode switcher"}
      onClick={() => setModesExpanded((expanded) => !expanded)}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-background/80 px-2.5 shadow-sm backdrop-blur-md",
        "text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11",
        "motion-safe:transition-colors",
      )}
    >
      <activeTab.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{activeTab.label}</span>
      {modesExpanded ? (
        <ChevronUp className="h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      )}
    </button>
  ) : null;
  const renderTabs = () => (
    <div
      className={cn(
        "mx-auto grid w-full max-w-xl grid-cols-2 rounded-2xl border border-border/70 bg-background/80 p-1.5 shadow-xl backdrop-blur-md",
        compact && "rounded-xl p-1",
      )}
    >
      {TABS.map(({ to, label, hint, icon: Icon }) => {
        const active = location.pathname === to;
        return (
          <Link
            key={to}
            to={to}
            replace
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 transition-[background-color,color,box-shadow] motion-reduce:transition-none pointer-coarse:min-h-11 sm:px-4",
              compact && "gap-2 px-3 py-1 sm:px-3 sm:py-1",
              active
                ? "bg-selection/15 text-selection shadow-sm ring-1 ring-selection/30"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors motion-reduce:transition-none",
                compact && "h-7 w-7",
                active
                  ? "border-selection/30 bg-selection/15"
                  : "border-border/60 bg-muted/40 group-hover:border-border",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-semibold">{label}</span>
              <span
                className={cn(
                  "hidden truncate text-[11px] text-muted-foreground sm:block",
                  compact && "sm:hidden",
                )}
              >
                {hint}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        {!compactCollapsed && (
          <nav
            aria-label="Offline play type"
            className={cn("shrink-0 px-4 pt-4 sm:px-6 lg:px-8", compact && "pt-1.5 sm:pt-1.5")}
          >
            {!compact && renderTabs()}
            {compact && modesExpanded && (
              <div className="mx-auto w-full max-w-xl">{renderTabs()}</div>
            )}
          </nav>
        )}
        <div className="min-h-0 flex-1">
          {typeof children === "function" ? children(modeToggle) : children}
        </div>
      </div>
    </div>
  );
}
