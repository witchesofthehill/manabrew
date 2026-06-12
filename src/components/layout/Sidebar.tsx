import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/features";
import { useGameStore } from "@/stores/useGameStore";
import {
  Github,
  Globe,
  HeartPulse,
  Home,
  Gamepad2,
  Hand,
  Layers,
  Package,
  Settings,
  Swords,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ManaBrewLogo } from "./ManaBrewLogo";

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  onNavigate?: () => void;
}

function DiscordIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.84a13.8 13.8 0 0 0-.64 1.32 18.43 18.43 0 0 0-5.44 0 12.69 12.69 0 0 0-.65-1.32A19.74 19.74 0 0 0 3.68 4.38C.55 9.02-.3 13.54.12 18a19.9 19.9 0 0 0 6.07 3.07 14.56 14.56 0 0 0 1.3-2.11 12.88 12.88 0 0 1-2.05-.98c.17-.12.34-.25.5-.38a14.12 14.12 0 0 0 12.12 0c.16.13.33.26.5.38-.65.39-1.33.72-2.05.98.38.74.82 1.45 1.3 2.1A19.84 19.84 0 0 0 23.88 18c.5-5.18-.85-9.65-3.56-13.63ZM8.02 15.26c-1.18 0-2.16-1.1-2.16-2.45 0-1.35.96-2.45 2.16-2.45 1.2 0 2.18 1.1 2.16 2.45 0 1.35-.96 2.45-2.16 2.45Zm7.96 0c-1.18 0-2.16-1.1-2.16-2.45 0-1.35.96-2.45 2.16-2.45 1.2 0 2.18 1.1 2.16 2.45 0 1.35-.96 2.45-2.16 2.45Z" />
    </svg>
  );
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
                  <Home className="mr-2 h-4 w-4 shrink-0" />
                  Lobby
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
          </div>
        </div>
      </div>
      <div className="mt-auto flex w-max items-center gap-3 overflow-visible px-7 py-4 shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-muted-foreground">
          Get in touch
        </p>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" className="shrink-0" title="Discord">
            <a href="https://discord.gg/NqrKpbhtcd" target="_blank" rel="noreferrer">
              <DiscordIcon className="h-4 w-4" />
              <span className="sr-only">Discord</span>
            </a>
          </Button>
          <span className="shrink-0 text-muted-foreground">|</span>
          <Button asChild variant="ghost" size="icon" className="shrink-0" title="GitHub">
            <a href="https://github.com/witchesofthehill/manabrew" target="_blank" rel="noreferrer">
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
