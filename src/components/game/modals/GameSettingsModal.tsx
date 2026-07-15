import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  CARD_SIZE_MULTIPLIER_MAX,
  CARD_SIZE_MULTIPLIER_MIN,
  usePreferencesStore,
} from "@/stores/usePreferencesStore";
import type { BattlefieldCardStyle, CardPreviewMode } from "@/stores/usePreferencesStore";
import {
  HOVER_DELAY_MAX,
  HOVER_DELAY_MIN,
  HOVER_DELAY_STEP,
} from "@/components/game/game.constants";

const CARD_STYLES: { value: BattlefieldCardStyle; label: string }[] = [
  { value: "realistic", label: "Realistic" },
  { value: "art", label: "Art-forward" },
  { value: "frame", label: "Mini-frame" },
];

const PREVIEW_MODES: { value: CardPreviewMode; label: string }[] = [
  { value: "hover", label: "Hover" },
  { value: "shift", label: "Shift" },
  { value: "alt", label: "Alt" },
  { value: "ctrl", label: "Ctrl" },
];

function SettingRow({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** In-game board settings, opened from the board menu (gear → Board settings).
 *  Every control writes usePreferencesStore directly, so changes apply to the
 *  live board immediately and persist like the Settings page equivalents. */
export function GameSettingsModal({ onClose }: { onClose: () => void }) {
  const prefs = usePreferencesStore();

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <Modal.Header onClose={onClose}>
        <h2 className="text-base font-semibold">Board settings</h2>
      </Modal.Header>
      <Modal.Body className="space-y-5">
        <SettingRow
          label={`Card size (${Math.round(prefs.cardSizeMultiplier * 100)}%)`}
          hint="Scales cards on every battlefield and your hand fan. 100% is the classic 3-row board; battlefield cards cap at a 2-row fill, the hand keeps growing past them."
        >
          <input
            type="range"
            min={Math.round(CARD_SIZE_MULTIPLIER_MIN * 100)}
            max={Math.round(CARD_SIZE_MULTIPLIER_MAX * 100)}
            step={5}
            value={Math.round(prefs.cardSizeMultiplier * 100)}
            onChange={(e) => prefs.setCardSizeMultiplier(Number(e.target.value) / 100)}
            className="w-full accent-primary"
          />
        </SettingRow>

        <SettingRow
          label="Card style"
          hint="How battlefield cards are drawn. Hand, stack, and previews always use the full card image."
        >
          <div className="flex items-center gap-2">
            {CARD_STYLES.map((s) => (
              <Button
                key={s.value}
                variant={prefs.battlefieldCardStyle === s.value ? "default" : "outline"}
                size="sm"
                onClick={() => prefs.setBattlefieldCardStyle(s.value)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </SettingRow>

        <SettingRow
          label="Battlefield layout"
          hint={'"Auto-arrange" keeps cards tidy in rows and ignores manual placement.'}
        >
          <div className="flex items-center gap-2">
            <Button
              variant={!prefs.battlefieldAutoSort ? "default" : "outline"}
              size="sm"
              onClick={() => prefs.setBattlefieldAutoSort(false)}
            >
              Free placement
            </Button>
            <Button
              variant={prefs.battlefieldAutoSort ? "default" : "outline"}
              size="sm"
              onClick={() => prefs.setBattlefieldAutoSort(true)}
            >
              Auto-arrange
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label="Lock zone piles"
          hint="Keeps the deck, graveyard, exile, and command piles fixed in place so a drag can't move them. Tapping to open still works."
        >
          <div className="flex items-center gap-2">
            <Button
              variant={!prefs.lockZoneTiles ? "default" : "outline"}
              size="sm"
              onClick={() => prefs.setLockZoneTiles(false)}
            >
              Movable
            </Button>
            <Button
              variant={prefs.lockZoneTiles ? "default" : "outline"}
              size="sm"
              onClick={() => prefs.setLockZoneTiles(true)}
            >
              Locked
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label="Animations"
          hint="Decorative board effects. Turn off to save performance on weaker hardware."
        >
          <div className="flex items-center gap-2">
            <Button
              variant={prefs.inGameAnimations ? "default" : "outline"}
              size="sm"
              onClick={() => prefs.setInGameAnimations(true)}
            >
              On
            </Button>
            <Button
              variant={!prefs.inGameAnimations ? "default" : "outline"}
              size="sm"
              onClick={() => prefs.setInGameAnimations(false)}
            >
              Off
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label="Card preview trigger"
          hint='When the big card preview appears. "Hover" shows on mouse over; the others need the modifier key held.'
        >
          <div className="flex items-center gap-2">
            {PREVIEW_MODES.map((m) => (
              <Button
                key={m.value}
                variant={prefs.cardPreviewMode === m.value ? "default" : "outline"}
                size="sm"
                onClick={() => prefs.setCardPreviewMode(m.value)}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </SettingRow>

        <SettingRow
          label={`Card preview delay (${prefs.cardHoverDelayMs}ms)`}
          hint="How long to hover before the preview appears."
        >
          <input
            type="range"
            min={HOVER_DELAY_MIN}
            max={HOVER_DELAY_MAX}
            step={HOVER_DELAY_STEP}
            value={prefs.cardHoverDelayMs}
            onChange={(e) => prefs.setCardHoverDelayMs(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </SettingRow>
      </Modal.Body>
      <Modal.Footer>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
