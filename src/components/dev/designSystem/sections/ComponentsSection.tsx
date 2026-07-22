import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FormatBadge } from "@/components/game/FormatBadge";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { GAME_FORMATS } from "@/lib/formats";
import { LEGALITY_STYLES } from "@/lib/constants";
import { resolveGameThemeColors } from "@/themes/gameTheme";
import { cn } from "@/lib/utils";
import { Section, Subhead, Panel } from "../kit";

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
const BUTTON_SIZES = ["sm", "default", "lg", "icon"] as const;
const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline"] as const;
const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "land"] as const;

export function ComponentsSection({ presetId }: { presetId: string }) {
  const g = resolveGameThemeColors({}, presetId);
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
      intro="Live shadcn primitives and domain badges, rendered under the selected preset. Change the preset in the header to re-skin everything below."
    >
      <Subhead>Button — variants × sizes</Subhead>
      <Panel className="space-y-3">
        {BUTTON_VARIANTS.map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 font-mono text-[11px] text-muted-foreground">
              {variant}
            </span>
            {BUTTON_SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {size === "icon" ? "★" : size}
              </Button>
            ))}
          </div>
        ))}
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
          <Subhead>Input</Subhead>
          <Panel className="space-y-2">
            <Input placeholder="Search cards…" />
            <Input defaultValue="Filled value" />
            <Input disabled placeholder="Disabled" />
          </Panel>
        </div>
        <div className="space-y-2">
          <Subhead>Checkbox</Subhead>
          <Panel className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox defaultChecked /> Checked
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox /> Unchecked
            </label>
          </Panel>
        </div>
      </div>

      <Subhead>Format badges</Subhead>
      <Panel className="flex flex-wrap gap-2">
        {GAME_FORMATS.map((f) => (
          <FormatBadge key={f.id} formatId={f.id} />
        ))}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Subhead>Legality</Subhead>
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
          <Subhead>Rarity</Subhead>
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

      <Subhead>Deck labels</Subhead>
      <Panel className="flex flex-wrap gap-2">
        {sampleLabels.map((label) => (
          <DeckLabelBadge key={label.name} label={label} size="md" />
        ))}
      </Panel>
    </Section>
  );
}
