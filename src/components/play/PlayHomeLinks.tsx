import {
  ArrowRight,
  Boxes,
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

const TOOL_TILE_CLASS =
  "group relative flex min-h-32 min-w-0 flex-col justify-between gap-3 overflow-hidden rounded-2xl border border-border/70 bg-card/85 p-4 shadow-md backdrop-blur-md motion-safe:transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-36 sm:p-5";

const TOOL_ACCENTS: Record<string, { chip: string; hoverBorder: string }> = {
  blue: {
    chip: "border-format-badge-blue/40 bg-format-badge-blue/15 text-format-badge-blue",
    hoverBorder: "hover:border-format-badge-blue/60",
  },
  rose: {
    chip: "border-format-badge-rose/40 bg-format-badge-rose/15 text-format-badge-rose",
    hoverBorder: "hover:border-format-badge-rose/60",
  },
  amber: {
    chip: "border-format-badge-amber/40 bg-format-badge-amber/15 text-format-badge-amber",
    hoverBorder: "hover:border-format-badge-amber/60",
  },
};

const TOOL_GRID_BY_COUNT: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

const UTILITY_ROW_CLASS =
  "flex min-w-0 items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 motion-safe:transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const TOOLS = [
  {
    to: ROUTES.PLAY_OFFLINE_LIMITED,
    label: "Draft & Sealed",
    desc: "Draft, sealed, Winston, and cube play.",
    icon: Boxes,
    tone: "amber",
  },
  {
    to: ROUTES.SEARCH,
    label: "Card Search",
    desc: "Every card, printing, and ruling at your fingertips.",
    icon: Search,
    tone: "blue",
  },
  {
    to: ROUTES.COMPANION,
    label: "Life Tracker",
    desc: "Life, poison, and commander damage for paper nights.",
    icon: HeartPulse,
    tone: "rose",
  },
  ...(FEATURES.tabletop
    ? [
        {
          to: ROUTES.TABLETOP,
          label: "Tabletop",
          desc: "A free sandbox table to test anything.",
          icon: Hand,
          tone: "amber",
        },
      ]
    : []),
];

export function PlayHomeLinks() {
  return (
    <>
      <section aria-label="More ways to play and tools">
        <div className={cn("grid gap-4", TOOL_GRID_BY_COUNT[TOOLS.length] ?? "sm:grid-cols-3")}>
          {TOOLS.map(({ to, label, desc, icon: Icon, tone }, index) => {
            const accent = TOOL_ACCENTS[tone] ?? TOOL_ACCENTS.blue;
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  TOOL_TILE_CLASS,
                  accent.hoverBorder,
                  TOOLS.length % 2 === 1 && index === TOOLS.length - 1 && "max-sm:col-span-2",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className="absolute -bottom-4 -right-4 h-24 w-24 rotate-12 text-foreground opacity-[0.05]"
                />
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border",
                    accent.chip,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="relative">
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {label}
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:text-foreground" />
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {desc}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section
        aria-label="Utilities"
        className="overflow-hidden rounded-xl border border-border/60 bg-background/60 backdrop-blur-md"
      >
        <ul className="divide-y divide-border/50 pb-1">
          <li>
            <Link to={ROUTES.SETTINGS} className={UTILITY_ROW_CLASS}>
              <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
              Preferences
            </Link>
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
