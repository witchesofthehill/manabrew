import {
  Gamepad2,
  Github,
  Globe,
  Hand,
  HeartPulse,
  Info,
  Palette,
  Search,
  Settings,
} from "lucide-react";
import { Link } from "react-router-dom";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import { UpdateCallout } from "@/components/layout/UpdateCallout";
import { Button } from "@/components/ui/button";
import { DESIGN_SYSTEM_ENABLED } from "@/config/designSystem";
import {
  APP_VERSION,
  DISCORD_INVITE_URL,
  GITHUB_REPO_URL,
  ROUTES,
  WEBSITE_URL,
} from "@/lib/constants";
import { FEATURES } from "@/lib/features";
import { cn } from "@/lib/utils";
import { useGameStore } from "@/stores/useGameStore";

const TOOL_TILE_CLASS =
  "group flex min-w-0 flex-col items-start gap-2.5 rounded-xl border border-border/70 bg-card/85 p-4 shadow-md backdrop-blur-md hover:border-primary/70 motion-safe:transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5";

const TOOL_ICON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary";

const UTILITY_ROW_CLASS =
  "flex min-w-0 items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 motion-safe:transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const TOOLS = [
  { to: ROUTES.SEARCH, label: "Card Search", icon: Search },
  { to: ROUTES.COMPANION, label: "Life Tracker", icon: HeartPulse },
  { to: ROUTES.MATCHES, label: "Active Matches", icon: Gamepad2 },
  ...(FEATURES.tabletop ? [{ to: ROUTES.TABLETOP, label: "Tabletop", icon: Hand }] : []),
];

export function PlayHomeLinks() {
  const isGameActive = useGameStore((s) => s.isGameActive);

  return (
    <>
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Tools
        </h2>
        <div
          className={cn(
            "grid gap-4",
            TOOLS.length === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3",
          )}
        >
          {TOOLS.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className={TOOL_TILE_CLASS}>
              <span className={TOOL_ICON_CLASS}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border/60 bg-background/60 backdrop-blur-md">
        <h2 className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Utilities
        </h2>
        <ul className="divide-y divide-border/50 pb-1">
          <li>
            {isGameActive ? (
              <span
                className="flex min-w-0 items-center gap-3 px-4 py-3 text-sm text-muted-foreground"
                title="Preferences are unavailable during an active game"
              >
                <Settings className="h-4 w-4 shrink-0" />
                Preferences
              </span>
            ) : (
              <Link to={ROUTES.SETTINGS} className={UTILITY_ROW_CLASS}>
                <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
                Preferences
              </Link>
            )}
          </li>
          <li>
            <Link to={ROUTES.ABOUT} className={UTILITY_ROW_CLASS}>
              <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
              About Manabrew
            </Link>
          </li>
          {DESIGN_SYSTEM_ENABLED && (
            <li>
              <Link to={ROUTES.DESIGN_SYSTEM} className={UTILITY_ROW_CLASS}>
                <Palette className="h-4 w-4 shrink-0 text-muted-foreground" />
                Design System
              </Link>
            </li>
          )}
        </ul>
      </section>

      <footer className="flex flex-col gap-3 border-t border-border/50 pt-5">
        <UpdateCallout />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Manabrew v{APP_VERSION}</span>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="Discord">
              <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
                <DiscordIcon className="h-4 w-4" />
                <span className="sr-only">Discord</span>
              </a>
            </Button>
            <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="GitHub">
              <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                <Github className="h-4 w-4" />
                <span className="sr-only">GitHub</span>
              </a>
            </Button>
            <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="Website">
              <a href={WEBSITE_URL} target="_blank" rel="noreferrer">
                <Globe className="h-4 w-4" />
                <span className="sr-only">Website</span>
              </a>
            </Button>
          </div>
        </div>
      </footer>
    </>
  );
}
