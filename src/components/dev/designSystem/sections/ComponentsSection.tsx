import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FormatBadge } from "@/components/game/FormatBadge";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { GAME_FORMATS } from "@/lib/formats";
import { LEGALITY_STYLES } from "@/lib/constants";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { Section, Subhead, Panel } from "../kit";
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
      <Subhead>Button — variants × sizes</Subhead>
      <Panel className="space-y-3">
        {BUTTON_VARIANTS.map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 font-mono text-ui-label text-muted-foreground">
              {variant}
            </span>
            {BUTTON_SIZES.map((size) => (
              <Button
                key={size}
                variant={variant}
                size={size}
                aria-label={size.startsWith("icon") ? `${variant} ${size}` : undefined}
              >
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

      <Subhead>Wrapping controls</Subhead>
      <Panel className="space-y-3">
        <p className="text-ui-body">
          Production controls keep their label size when space is tight. Long labels wrap instead of
          clipping or reducing the type size.
        </p>
        <div className="flex max-w-xs flex-col items-stretch gap-2">
          <Button variant="outline" className="whitespace-normal break-words text-left">
            Browse every card in this deck and its sideboard
          </Button>
          <label className="flex min-h-9 items-center gap-2 text-ui-label touch:min-h-11">
            <Checkbox />
            Include cards from every available set in this collection
          </label>
        </div>
        <p className="text-ui-meta text-muted-foreground">
          Labels use 14px with a fine pointer, 16px on compact touch viewports and 20px on touch
          viewports at least 48rem wide. Touch targets remain at least 44px.
        </p>
        <p className="text-ui-caption text-muted-foreground">Optional specimen annotation.</p>
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
            <Label htmlFor="ds-search-cards">Search cards</Label>
            <Input id="ds-search-cards" placeholder={`Search cards\u2026`} />
            <Label htmlFor="ds-filled-input">Filled input</Label>
            <Input id="ds-filled-input" defaultValue="Filled value" />
            <Label htmlFor="ds-disabled-input">Disabled input</Label>
            <Input id="ds-disabled-input" disabled placeholder={`Disabled`} />
            <p className="text-ui-meta text-muted-foreground">
              Input text is 14px with a fine pointer, 16px on compact touch viewports and 20px on
              touch viewports at least 48rem wide.
            </p>
          </Panel>
        </div>
        <div className="space-y-2">
          <Subhead>Checkbox</Subhead>
          <Panel className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex min-h-9 items-center gap-2 text-ui-label touch:min-h-11">
              <Checkbox defaultChecked /> Checked
            </label>
            <label className="flex min-h-9 items-center gap-2 text-ui-label touch:min-h-11">
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
                className={cn("rounded-md border px-2 py-0.5 text-ui-meta font-semibold", cls)}
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
                className={cn("flex items-center gap-1.5 text-ui-meta font-semibold capitalize", {
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
