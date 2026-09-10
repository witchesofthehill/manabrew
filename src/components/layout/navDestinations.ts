import type { ComponentType } from "react";
import { msg } from "@lingui/core/macro";
import {
  Github,
  HeartPulse,
  Info,
  Layers,
  LibraryBig,
  PackageOpen,
  Palette,
  Search,
  Swords,
  Users,
} from "lucide-react";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import { DESIGN_SYSTEM_ENABLED } from "@/config/designSystem";
import { isFeatureEnabled } from "@/featureFlags";
import { DISCORD_INVITE_URL, GITHUB_REPO_URL, ROUTES } from "@/lib/constants";
import { i18n } from "@/i18n/i18n";

export interface NavDestination {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  external?: boolean;
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

export function getTopBarNav(signedIn = false): NavDestination[] {
  const direct: NavDestination[] = [
    { to: ROUTES.PLAY_OFFLINE_CONSTRUCTED, label: i18n._(msg`Play Offline`), icon: Swords },
    { to: ROUTES.LOBBY, label: i18n._(msg`Multiplayer`), icon: Users },
    { to: ROUTES.DECK_EDITOR, label: i18n._(msg`My Decks`), icon: Layers },
  ];

  if (isFeatureEnabled("deckHub")) {
    direct.push({ to: ROUTES.HUB, label: i18n._(msg`Community`), icon: LibraryBig });
  }

  if (signedIn && isFeatureEnabled("accounts")) {
    direct.push({
      to: ROUTES.MY_COLLECTION,
      label: i18n._(msg`My Collection`),
      icon: PackageOpen,
    });
  }

  direct.push(
    { to: ROUTES.SEARCH, label: i18n._(msg`Card Search`), icon: Search },
    { to: ROUTES.COMPANION, label: i18n._(msg`Life Tracker`), icon: HeartPulse },
  );
  return direct;
}

export function getMoreDestinations(): NavDestination[] {
  const more: NavDestination[] = [{ to: ROUTES.ABOUT, label: i18n._(msg`About`), icon: Info }];
  if (DESIGN_SYSTEM_ENABLED) {
    more.push({ to: ROUTES.DESIGN_SYSTEM, label: i18n._(msg`Design System`), icon: Palette });
  }
  more.push(
    { to: DISCORD_INVITE_URL, label: "Discord", icon: DiscordIcon, external: true },
    { to: GITHUB_REPO_URL, label: "GitHub", icon: Github, external: true },
  );
  return more;
}
