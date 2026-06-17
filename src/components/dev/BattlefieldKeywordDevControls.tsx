import { useState } from "react";
import { cn } from "@/lib/utils";
import { useGameDevStore } from "@/stores/useGameDevStore";

const DEV_BATTLEFIELD_KEYWORDS: string[] = [
  "Flying",
  "First strike",
  "Double strike",
  "Trample",
  "Vigilance",
  "Haste",
  "Reach",
  "Lifelink",
  "Deathtouch",
  "Menace",
  "Defender",
  "Hexproof",
  "Indestructible",
  "Shroud",
  "Flash",
  "Prowess",
  "Ward:{2}",
  "Protection",
  "Phasing",
  "Shadow",
  "Horsemanship",
  "Skulk",
  "Fear",
  "Intimidate",
  "Cycling:{1}",
  "Equip:{2}",
  "Adapt:{3}",
  "Kicker:{R}",
  "Madness:{B}",
  "Buyback:{2}",
  "Flashback:{2}{R}",
  "Echo:{1}",
  "Bestow:{4}{W}",
  "Cascade",
  "Convoke",
  "Delve",
  "Dredge",
  "Embalm",
  "Eternalize",
  "Investigate",
  "Storm",
  "Affinity",
  "Annihilator",
  "Persist",
  "Undying",
  "Modular",
  "Bushido",
  "Exalted",
];

export function BattlefieldKeywordDevControls() {
  const selected = useGameDevStore((s) => s.debugBattlefieldKeywords);
  const toggle = useGameDevStore((s) => s.toggleDebugBattlefieldKeyword);
  const clear = useGameDevStore((s) => s.clearDebugBattlefieldKeywords);
  const debugCardEnabled = useGameDevStore((s) => s.debugCardEnabled);
  const debugCardName = useGameDevStore((s) => s.debugCardName);
  const setDebugCardEnabled = useGameDevStore((s) => s.setDebugCardEnabled);
  const setDebugCardName = useGameDevStore((s) => s.setDebugCardName);
  const showHoverAreas = useGameDevStore((s) => s.showHoverAreas);
  const setShowHoverAreas = useGameDevStore((s) => s.setShowHoverAreas);

  const [draftName, setDraftName] = useState(debugCardName);

  const commitName = () => {
    const next = draftName.trim();
    if (next && next !== debugCardName) setDebugCardName(next);
    else setDraftName(debugCardName);
  };

  const dirty = selected.length > 0;

  return (
    <div className="flex flex-col gap-2 mt-2 rounded-md border border-border/70 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Debug card (self)
        </span>
        {dirty && (
          <button
            className="text-[10px] uppercase text-muted-foreground hover:text-destructive"
            onClick={clear}
          >
            Clear keywords ({selected.length})
          </button>
        )}
      </div>

      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <span className="text-xs">Show debug card on battlefield</span>
        <button
          type="button"
          role="switch"
          aria-checked={debugCardEnabled}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
            debugCardEnabled ? "border-primary bg-primary" : "border-border/70 bg-muted",
          )}
          onClick={() => setDebugCardEnabled(!debugCardEnabled)}
        >
          <span
            className={cn(
              "block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
              debugCardEnabled ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </label>

      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <span className="text-xs">Show hover areas (hand, battlefield, preview)</span>
        <button
          type="button"
          role="switch"
          aria-checked={showHoverAreas}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
            showHoverAreas ? "border-primary bg-primary" : "border-border/70 bg-muted",
          )}
          onClick={() => setShowHoverAreas(!showHoverAreas)}
        >
          <span
            className={cn(
              "block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
              showHoverAreas ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </label>

      <div className="flex items-center gap-1">
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraftName(debugCardName);
              e.currentTarget.blur();
            }
          }}
          placeholder="Scryfall card name"
          className="flex-1 px-2 py-1 rounded text-xs border border-border/70 bg-background text-foreground"
          spellCheck={false}
        />
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Image, type line, and hover preview resolve via Scryfall fuzzy name lookup. Keyword chips +
        card-state overrides below render on top.
      </p>

      <div className="grid grid-cols-2 gap-1">
        {DEV_BATTLEFIELD_KEYWORDS.map((kw) => {
          const active = selected.includes(kw);
          return (
            <button
              key={kw}
              type="button"
              className={cn(
                "px-1.5 py-1 rounded text-[10px] font-medium border truncate",
                active
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
              onClick={() => toggle(kw)}
              title={kw}
            >
              {kw}
            </button>
          );
        })}
      </div>
    </div>
  );
}
