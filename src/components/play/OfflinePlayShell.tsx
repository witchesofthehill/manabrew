import type { ReactNode } from "react";
import { Boxes, Swords } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
interface OfflinePlayShellProps {
  children: ReactNode | ((modeToggle: ReactNode) => ReactNode);
}
const TABS = [
  {
    to: ROUTES.PLAY_OFFLINE_CONSTRUCTED,
    label: `Constructed`,
    hint: `Deck vs AI`,
    icon: Swords,
  },
  {
    to: ROUTES.PLAY_OFFLINE_LIMITED,
    label: `Limited`,
    hint: `Draft & sealed`,
    icon: Boxes,
  },
];
export function OfflinePlayShell({ children }: OfflinePlayShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const compact = shortScreen && isTouch;

  const modeToggle = compact ? (
    <AppSelect
      aria-label="Offline play mode"
      value={location.pathname}
      onValueChange={(value) => navigate(value, { replace: true })}
      className="min-h-11 shrink-0 text-ui-label font-medium"
    >
      {TABS.map(({ to, label, icon: Icon }) => (
        <AppSelectOption key={to} value={to}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {label}
        </AppSelectOption>
      ))}
    </AppSelect>
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
              "group flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 transition-[background-color,color,box-shadow] motion-reduce:transition-none touch:min-h-11 sm:px-4",
              compact && "gap-2 px-3 py-1 sm:px-3 sm:py-1",
              active
                ? "bg-selection text-selection-foreground shadow-sm ring-1 ring-selection-border"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors motion-reduce:transition-none",
                compact && "h-7 w-7",
                active
                  ? "border-selection-border/30 bg-selection"
                  : "border-border/60 bg-muted/40 group-hover:border-border",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block break-words text-ui-label font-semibold">{label}</span>
              <span
                className={cn(
                  "hidden break-words text-ui-meta text-muted-foreground sm:block",
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
        {!compact && (
          <nav aria-label="Offline play type" className="shrink-0 px-4 pt-4 sm:px-6 lg:px-8">
            {renderTabs()}
          </nav>
        )}
        <div className="min-h-0 flex-1">
          {typeof children === "function" ? children(modeToggle) : children}
        </div>
      </div>
    </div>
  );
}
