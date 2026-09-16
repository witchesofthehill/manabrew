import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FormatBadge } from "@/components/game/FormatBadge";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { GAME_FORMATS } from "@/lib/formats";
import { LEGALITY_STYLES } from "@/lib/constants";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { Section, Subhead, Panel } from "../kit";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
const BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "outline",
  "ghost",
  "destructive-quiet",
  "destructive",
  "selected",
  "link",
] as const;
const BUTTON_SIZES = ["xs", "sm", "default", "lg", "icon-xs", "icon-sm", "icon"] as const;
const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline"] as const;
const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "land"] as const;

export function ComponentsSection() {
  const g = useTheme().gameTheme;
  const sampleLabels = [
    { name: "Aggro", color: g.formatBadge.rose },
    { name: "Control", color: g.formatBadge.blue },
    { name: "Ramp", color: g.formatBadge.emerald },
    { name: "Combo", color: g.formatBadge.purple },
  ];
  return (
    <Section
      id="components"
      title="Components"
      intro="App controls and game badges rendered with your current theme."
    >
      <Subhead>
        <Trans>Button — variants × sizes</Trans>
      </Subhead>
      <Panel className="space-y-3">
        {BUTTON_VARIANTS.map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 font-mono text-[11px] text-muted-foreground">
              {variant}
            </span>
            {BUTTON_SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {size.startsWith("icon") ? "★" : size}
              </Button>
            ))}
          </div>
        ))}
      </Panel>

      <Subhead>Button states</Subhead>
      <Panel className="flex flex-wrap gap-2">
        <Button variant="selected" aria-pressed>
          Pressed
        </Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
      </Panel>

      <Subhead>Badge — variants</Subhead>
      <Panel className="flex flex-wrap gap-2">
        {BADGE_VARIANTS.map((variant) => (
          <Badge key={variant} variant={variant}>
            {variant}
          </Badge>
        ))}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Subhead>
            <Trans>Input</Trans>
          </Subhead>
          <Panel className="space-y-2">
            <Input placeholder={i18n._(msg`Search cards\u2026`)} />
            <Input defaultValue="Filled value" />
            <Input disabled placeholder={i18n._(msg`Disabled`)} />
          </Panel>
        </div>
        <div className="space-y-2">
          <Subhead>
            <Trans>Checkbox</Trans>
          </Subhead>
          <Panel className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Trans>
                <Checkbox defaultChecked /> Checked
              </Trans>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Trans>
                <Checkbox /> Unchecked
              </Trans>
            </label>
          </Panel>
        </div>
      </div>

      <Subhead>
        <Trans>Format badges</Trans>
      </Subhead>
      <Panel className="flex flex-wrap gap-2">
        {GAME_FORMATS.map((f) => (
          <FormatBadge key={f.id} formatId={f.id} />
        ))}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Subhead>
            <Trans>Legality</Trans>
          </Subhead>
          <Panel className="flex flex-wrap gap-2">
            {Object.entries(LEGALITY_STYLES).map(([key, cls]) => (
              <span
                key={key}
                className={cn("rounded-md border px-2 py-0.5 text-xs font-semibold", cls)}
              >
                {key}
              </span>
            ))}
          </Panel>
        </div>
        <div className="space-y-2">
          <Subhead>
            <Trans>Rarity</Trans>
          </Subhead>
          <Panel className="flex flex-wrap gap-3">
            {RARITIES.map((r) => (
              <span
                key={r}
                className={cn("flex items-center gap-1.5 text-xs font-semibold capitalize", {
                  "text-rarity-common": r === "common",
                  "text-rarity-uncommon": r === "uncommon",
                  "text-rarity-rare": r === "rare",
                  "text-rarity-mythic": r === "mythic",
                  "text-rarity-special": r === "special",
                  "text-rarity-land": r === "land",
                })}
              >
                <span className="h-2.5 w-2.5 rounded-full bg-current" />
                {r}
              </span>
            ))}
          </Panel>
        </div>
      </div>

      <Subhead>
        <Trans>Deck labels</Trans>
      </Subhead>
      <Panel className="flex flex-wrap gap-2">
        {sampleLabels.map((label) => (
          <DeckLabelBadge key={label.name} label={label} size="md" />
        ))}
      </Panel>
    </Section>
  );
}
