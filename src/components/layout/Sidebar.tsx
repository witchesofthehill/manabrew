import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/features";
import { DISCORD_INVITE_URL, GITHUB_REPO_URL } from "@/lib/constants";
import { useGameStore } from "@/stores/useGameStore";
import {
  Github,
  Globe,
  HeartPulse,
  Gamepad2,
  Hand,
  Info,
  Layers,
  LibraryBig,
  Package,
  Settings,
  Swords,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import { ManaBrewLogo } from "./ManaBrewLogo";
import { SidebarUpdate } from "./SidebarUpdate";

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  onNavigate?: () => void;
}

export function Sidebar({ className, onNavigate }: SidebarProps) {
  const isGameActive = useGameStore((s) => s.isGameActive);

  return (
    <div
      className={cn(
        "w-full h-full bg-background flex flex-col border-r overflow-visible",
        className,
      )}
    >
      <div className="flex-1 min-h-0 space-y-4 overflow-x-hidden overflow-y-auto py-4">
        <div className="px-3 py-2">
          <div className="mb-2 px-4">
            <ManaBrewLogo size={256} className="w-full h-auto rounded-xl" />
          </div>
          <div className="space-y-1">
            <NavLink to="/play" onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start whitespace-nowrap"
                >
                  <Swords className="mr-2 h-4 w-4 shrink-0" />
                  Play
                </Button>
              )}
            </NavLink>
            <NavLink to="/lobby" onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start whitespace-nowrap"
                >
                  <Globe className="mr-2 h-4 w-4 shrink-0" />
                  Online
                </Button>
              )}
            </NavLink>
            <NavLink to="/search" onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start whitespace-nowrap"
                >
                  <Search className="mr-2 h-4 w-4 shrink-0" />
                  Card Search
                </Button>
              )}
            </NavLink>
            <NavLink to="/deck-editor" onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start whitespace-nowrap"
                >
                  <Layers className="mr-2 h-4 w-4 shrink-0" />
                  My Decks
                </Button>
              )}
            </NavLink>
            <NavLink to="/hub" onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start whitespace-nowrap"
                >
                  <LibraryBig className="mr-2 h-4 w-4 shrink-0" />
                  Deck Hub
                </Button>
              )}
            </NavLink>
            <NavLink to="/companion" onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start whitespace-nowrap"
                >
                  <HeartPulse className="mr-2 h-4 w-4 shrink-0" />
                  Life Tracker
                </Button>
              )}
            </NavLink>
            <NavLink to="/limited" onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start whitespace-nowrap"
                >
                  <Package className="mr-2 h-4 w-4 shrink-0" />
                  Limited
                </Button>
              )}
            </NavLink>
            <NavLink to="/matches" onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start whitespace-nowrap"
                >
                  <Gamepad2 className="mr-2 h-4 w-4 shrink-0" />
                  Active Matches
                </Button>
              )}
            </NavLink>
          </div>
        </div>
        {FEATURES.tabletop && (
          <div className="px-3 py-2">
            <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight">Sandbox</h2>
            <div className="space-y-1">
              <NavLink to="/tabletop" onClick={onNavigate}>
                {({ isActive }) => (
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    className="w-full justify-start whitespace-nowrap"
                  >
                    <Hand className="mr-2 h-4 w-4 shrink-0" />
                    Tabletop
                  </Button>
                )}
              </NavLink>
            </div>
          </div>
        )}
        <div className="px-3 py-2">
          <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight">Settings</h2>
          <div className="space-y-1">
            {isGameActive ? (
              <Button
                variant="ghost"
                className="w-full justify-start"
                disabled
                title="Preferences are unavailable during an active game"
              >
                <Settings className="mr-2 h-4 w-4" />
                Preferences
              </Button>
            ) : (
              <NavLink to="/settings" onClick={onNavigate}>
                {({ isActive }) => (
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    className="w-full justify-start whitespace-nowrap"
                  >
                    <Settings className="mr-2 h-4 w-4 shrink-0" />
                    Preferences
                  </Button>
                )}
              </NavLink>
            )}
            <NavLink to="/about" onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start whitespace-nowrap"
                >
                  <Info className="mr-2 h-4 w-4 shrink-0" />
                  About Manabrew
                </Button>
              )}
            </NavLink>
          </div>
        </div>
      </div>
      <SidebarUpdate />
      <div className="mt-auto flex w-full flex-col gap-1.5 px-4 py-4 shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Get in touch
        </p>
        <div className="-ml-2.5 flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" className="shrink-0" title="Discord">
            <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
              <DiscordIcon className="h-4 w-4" />
              <span className="sr-only">Discord</span>
            </a>
          </Button>
          <span className="shrink-0 text-muted-foreground">|</span>
          <Button asChild variant="ghost" size="icon" className="shrink-0" title="GitHub">
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
              <Github className="h-4 w-4" />
              <span className="sr-only">GitHub</span>
            </a>
          </Button>
          <span className="shrink-0 text-muted-foreground">|</span>
          <Button asChild variant="ghost" size="icon" className="shrink-0" title="Website">
            <a href="https://manabrew.app" target="_blank" rel="noreferrer">
              <Globe className="h-4 w-4" />
              <span className="sr-only">Website</span>
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
