import { useId, type ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import {
  CARD_SIZE_MULTIPLIER_MAX,
  CARD_SIZE_MULTIPLIER_MIN,
  usePreferencesStore,
} from "@/stores/usePreferencesStore";
import {
  HOVER_DELAY_MAX,
  HOVER_DELAY_MIN,
  HOVER_DELAY_STEP,
} from "@/components/game/game.constants";
import { BATTLEFIELD_CARD_STYLE_OPTIONS } from "@/components/game/battlefieldCardStyles";
import {
  INLINE_CARD_STYLE_OPTIONS,
  IN_GAME_CARD_PREVIEW_STYLE_OPTIONS,
} from "@/components/game/cardPreviewStyles";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { HAND_ORDER_OPTIONS } from "@/lib/handOrder";

function Choice<T extends string | boolean>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={String(option.value)}
            size="sm"
            variant={value === option.value ? "default" : "outline"}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-5 rounded-xl border bg-muted/10 p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
const ON_OFF = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];

export function GameSettingsModal({ onClose }: { onClose: () => void }) {
  const prefs = usePreferencesStore();
  const fullControl = usePromptPreferencesStore((s) => s.fullControl);
  const setFullControl = usePromptPreferencesStore((s) => s.setFullControl);
  const id = useId();
  return (
    <Modal onClose={onClose} maxWidth="max-w-xl">
      <Modal.CloseShortcut keybinding="open-settings" onClose={onClose} />
      <Modal.Header onClose={onClose}>
        <h2 className="text-base font-semibold">Board settings</h2>
        <p className="text-xs text-muted-foreground">
          Changes apply immediately. Card view and front/back face are separate controls.
        </p>
      </Modal.Header>
      <Modal.Body className="space-y-4">
        <Section title="Cards and previews">
          <Choice
            label="Sort hand"
            value={prefs.handOrderMode}
            options={HAND_ORDER_OPTIONS}
            onChange={prefs.setHandOrderMode}
            hint="Manual preserves your placement; automatic modes arrange new cards."
          />
          <Choice
            label="Hand default view"
            value={prefs.handCardStyle}
            options={INLINE_CARD_STYLE_OPTIONS}
            onChange={prefs.setHandCardStyle}
          />
          <Choice
            label="Stack default view"
            value={prefs.stackCardStyle}
            options={INLINE_CARD_STYLE_OPTIONS}
            onChange={prefs.setStackCardStyle}
          />
          <Choice
            label="Prompt and dialog default view"
            value={prefs.promptCardStyle}
            options={INLINE_CARD_STYLE_OPTIONS}
            onChange={prefs.setPromptCardStyle}
            hint="Realistic uses printed art. Rules shows card rules and current game information. Individual cards can still be switched."
          />
          <Choice
            label="Board hover preview view"
            value={prefs.inGameCardPreviewStyle}
            options={IN_GAME_CARD_PREVIEW_STYLE_OPTIONS}
            onChange={prefs.setInGameCardPreviewStyle}
          />
        </Section>
        <Section title="Priority and prompts">
          <Choice
            label="Priority windows"
            value={fullControl}
            options={[
              { value: false, label: "Autopass" },
              { value: true, label: "Full control" },
            ]}
            onChange={setFullControl}
            hint="Full control stops at every window. Autopass skips windows with only mana abilities after a short delay."
          />
          <Choice
            label="Choose simultaneous trigger order"
            value={prefs.chooseOrderOnMultipleTriggers}
            options={ON_OFF}
            onChange={prefs.setChooseOrderOnMultipleTriggers}
            hint="When off, simultaneous triggers are ordered automatically."
          />
        </Section>
        <Section title="Board appearance">
          <div className="space-y-2">
            <label htmlFor={`${id}-size`} className="text-sm font-medium">
              Card size · {Math.round(prefs.cardSizeMultiplier * 100)}%
            </label>
            <input
              id={`${id}-size`}
              type="range"
              min={CARD_SIZE_MULTIPLIER_MIN * 100}
              max={CARD_SIZE_MULTIPLIER_MAX * 100}
              step={5}
              value={prefs.cardSizeMultiplier * 100}
              onChange={(e) => prefs.setCardSizeMultiplier(Number(e.target.value) / 100)}
              className="w-full accent-primary"
            />
          </div>
          <Choice
            label="Battlefield card style"
            value={prefs.battlefieldCardStyle}
            options={BATTLEFIELD_CARD_STYLE_OPTIONS}
            onChange={prefs.setBattlefieldCardStyle}
            hint="Applies to battlefield cards. Hand, stack and dialog view settings are independent."
          />
          <Choice
            label="Battlefield arrangement"
            value={prefs.battlefieldAutoSort}
            options={[
              { value: false, label: "Free placement" },
              { value: true, label: "Auto-arrange" },
            ]}
            onChange={prefs.setBattlefieldAutoSort}
          />
          <Choice
            label="Opponent layout"
            value={prefs.opponentLayout}
            options={[
              { value: "focused", label: "Focused" },
              { value: "overview", label: "Overview" },
            ]}
            onChange={prefs.setOpponentLayout}
          />
          <Choice
            label="Zone piles"
            value={prefs.lockZoneTiles}
            options={[
              { value: false, label: "Movable" },
              { value: true, label: "Locked" },
            ]}
            onChange={prefs.setLockZoneTiles}
            hint="Locking prevents dragging piles; viewing their cards remains available."
          />
          <Choice
            label="Decorative animations"
            value={prefs.inGameAnimations}
            options={ON_OFF}
            onChange={prefs.setInGameAnimations}
          />
        </Section>
        <Section title="Inspection input">
          <Choice
            label="Board preview trigger"
            value={prefs.cardPreviewMode}
            options={[
              { value: "hover", label: "Hover" },
              { value: "right-click", label: "Right click" },
            ]}
            onChange={prefs.setCardPreviewMode}
            hint="Zone explorers support persistent tap and keyboard inspection independently."
          />
          <div className="space-y-2">
            <label htmlFor={`${id}-delay`} className="text-sm font-medium">
              Hover delay · {prefs.cardHoverDelayMs}ms
            </label>
            <input
              id={`${id}-delay`}
              type="range"
              min={HOVER_DELAY_MIN}
              max={HOVER_DELAY_MAX}
              step={HOVER_DELAY_STEP}
              value={prefs.cardHoverDelayMs}
              onChange={(e) => prefs.setCardHoverDelayMs(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        </Section>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close onClose={onClose}>Done</Modal.Close>
      </Modal.Footer>
    </Modal>
  );
}
