import type { ComponentType } from "react";
import {
  Github,
  Hand,
  HeartPulse,
  Info,
  Layers,
  LibraryBig,
  MoreHorizontal,
  Palette,
  Search,
  Swords,
  Users,
} from "lucide-react";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import { DESIGN_SYSTEM_ENABLED } from "@/config/designSystem";
import { isFeatureEnabled } from "@/featureFlags";
import { DISCORD_INVITE_URL, GITHUB_REPO_URL, ROUTES } from "@/lib/constants";
import { FEATURES } from "@/lib/features";

export interface NavDestination {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  external?: boolean;
}

export interface NavMenu {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  items: NavDestination[];
}

export function getTopBarNav(): { direct: NavDestination[]; menus: NavMenu[] } {
  const direct: NavDestination[] = [
    { to: ROUTES.PLAY_OFFLINE_CONSTRUCTED, label: "Play Offline", icon: Swords },
    { to: ROUTES.LOBBY, label: "Multiplayer", icon: Users },
  ];
  const menus: NavMenu[] = [];

  if (isFeatureEnabled("deckHub")) {
    menus.push({
      id: "decks",
      label: "Decks",
      icon: Layers,
      items: [
        { to: ROUTES.DECK_EDITOR, label: "My Decks", icon: Layers },
        { to: ROUTES.HUB, label: "Deck Hub", icon: LibraryBig },
      ],
    });
  } else {
    direct.push({ to: ROUTES.DECK_EDITOR, label: "My Decks", icon: Layers });
  }

  direct.push(
    { to: ROUTES.SEARCH, label: "Card Search", icon: Search },
    { to: ROUTES.COMPANION, label: "Life Tracker", icon: HeartPulse },
  );
  if (FEATURES.tabletop) {
    direct.push({ to: ROUTES.TABLETOP, label: "Tabletop", icon: Hand });
  }

  const more: NavDestination[] = [{ to: ROUTES.ABOUT, label: "About", icon: Info }];
  if (DESIGN_SYSTEM_ENABLED) {
    more.push({ to: ROUTES.DESIGN_SYSTEM, label: "Design System", icon: Palette });
  }
  more.push(
    { to: DISCORD_INVITE_URL, label: "Discord", icon: DiscordIcon, external: true },
    { to: GITHUB_REPO_URL, label: "GitHub", icon: Github, external: true },
  );
  menus.push({ id: "more", label: "More", icon: MoreHorizontal, items: more });

  return { direct, menus };
}
