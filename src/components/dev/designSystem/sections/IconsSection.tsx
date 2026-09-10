import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { GameIcon } from "@/components/game/GameIcon";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { CounterBadge } from "@/components/game/CounterBadge";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import { VortexCircleIcon } from "@/components/icons/VortexCircleIcon";
import { Section, Subhead, Panel, Tile, TileGrid } from "../kit";
import { LUCIDE_GROUPS, GAME_ICONS, COUNTER_TYPES, MANA_COSTS } from "../designSystem.data";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
const lucideByName = LucideIcons as unknown as Record<string, LucideIcon>;
export function IconsSection() {
  return (
    <Section
      id="icons"
      title={i18n._(msg`Iconography`)}
      intro="Chrome uses lucide-react (h-4 w-4, currentColor). Domain glyphs come from the game-icons pack via GameIcon, two hand-rolled brand SVGs, Scryfall mana symbols, and themed counter chips."
    >
      <div className="space-y-4">
        <Subhead>
          <Trans>lucide-react — UI chrome</Trans>
        </Subhead>
        {LUCIDE_GROUPS.map((grp) => (
          <div key={grp.group} className="space-y-2">
            <div className="font-mono text-[11px] text-muted-foreground">{grp.group}</div>
            <TileGrid>
              {grp.names.map((name) => {
                const Icon = lucideByName[name];
                return (
                  <Tile key={name} label={name}>
                    {Icon ? <Icon className="h-5 w-5" /> : <span className="text-xs">?</span>}
                  </Tile>
                );
              })}
            </TileGrid>
          </div>
        ))}
      </div>

      <Subhead>
        <Trans>game-icons — GameIcon whitelist</Trans>
      </Subhead>
      <TileGrid>
        {GAME_ICONS.map((name) => (
          <Tile key={name} label={name}>
            <GameIcon name={name} className="h-6 w-6" />
          </Tile>
        ))}
      </TileGrid>

      <Subhead>
        <Trans>Hand-rolled brand SVGs</Trans>
      </Subhead>
      <TileGrid>
        <Tile label={i18n._(msg`DiscordIcon`)}>
          <DiscordIcon className="h-6 w-6" />
        </Tile>
        <Tile label={i18n._(msg`VortexCircleIcon (exile)`)}>
          <VortexCircleIcon className="h-6 w-6" />
        </Tile>
      </TileGrid>

      <Subhead>
        <Trans>Mana symbols — ManaSymbols (Scryfall SVG)</Trans>
      </Subhead>
      <Panel className="space-y-3">
        {MANA_COSTS.map((m) => (
          <div key={m.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs text-muted-foreground">{m.label}</span>
            <ManaSymbols cost={m.cost} size="lg" />
            <span className="font-mono text-[11px] text-muted-foreground">{m.cost}</span>
          </div>
        ))}
      </Panel>

      <Subhead>
        <Trans>Counters — CounterBadge</Trans>
      </Subhead>
      <div className="flex flex-wrap gap-2">
        {COUNTER_TYPES.map((type) => (
          <CounterBadge key={type} type={type} count={3} size="md" />
        ))}
      </div>
    </Section>
  );
}
