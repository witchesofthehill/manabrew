import type { ComponentType } from "react";
import {
  Github,
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
  iconOnly?: boolean;
  items: NavDestination[];
}

export function isNavDestinationActive(to: string, pathname: string): boolean {
  pathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (to === ROUTES.PLAY_OFFLINE_CONSTRUCTED) {
    return (
      pathname.startsWith(ROUTES.PLAY_OFFLINE) ||
      (pathname.startsWith(`${ROUTES.DRAFT}/`) && pathname !== `${ROUTES.DRAFT}/multiplayer`) ||
      (pathname.startsWith(`${ROUTES.SEALED}/`) && pathname !== `${ROUTES.SEALED}/multiplayer`) ||
      pathname.startsWith(`${ROUTES.WINSTON}/`) ||
      pathname.startsWith(`${ROUTES.GAUNTLET}/`)
    );
  }
  if (to === ROUTES.LOBBY) {
    return (
      pathname === ROUTES.LOBBY ||
      pathname === `${ROUTES.DRAFT}/multiplayer` ||
      pathname === `${ROUTES.SEALED}/multiplayer`
    );
  }
  if (to === ROUTES.PLAY) {
    return pathname === ROUTES.PLAY;
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function getTopBarNav(signedIn = false): { direct: NavDestination[]; menus: NavMenu[] } {
  const direct: NavDestination[] = [
    { to: ROUTES.PLAY_OFFLINE_CONSTRUCTED, label: "Play Offline", icon: Swords },
    { to: ROUTES.LOBBY, label: "Multiplayer", icon: Users },
    { to: ROUTES.DECK_EDITOR, label: "My Decks", icon: Layers },
  ];
  const menus: NavMenu[] = [];

  if (isFeatureEnabled("deckHub")) {
    direct.push({ to: ROUTES.HUB, label: "Community", icon: LibraryBig });
  }

  if (signedIn && isFeatureEnabled("accounts")) {
    direct.push({ to: ROUTES.MY_COLLECTION, label: "My Collection", icon: LibraryBig });
  }

  direct.push(
    { to: ROUTES.SEARCH, label: "Card Search", icon: Search },
    { to: ROUTES.COMPANION, label: "Life Tracker", icon: HeartPulse },
  );
  const more: NavDestination[] = [{ to: ROUTES.ABOUT, label: "About", icon: Info }];
  if (DESIGN_SYSTEM_ENABLED) {
    more.push({ to: ROUTES.DESIGN_SYSTEM, label: "Design System", icon: Palette });
  }
  more.push(
    { to: DISCORD_INVITE_URL, label: "Discord", icon: DiscordIcon, external: true },
    { to: GITHUB_REPO_URL, label: "GitHub", icon: Github, external: true },
  );
  menus.push({ id: "more", label: "More", icon: MoreHorizontal, iconOnly: true, items: more });

  return { direct, menus };
}
