import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  CARD_SIZE_MULTIPLIER_MAX,
  CARD_SIZE_MULTIPLIER_MIN,
  usePreferencesStore,
} from "@/stores/usePreferencesStore";
import type { CardPreviewMode, InlineCardStyle } from "@/stores/usePreferencesStore";
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

const PREVIEW_MODES: { value: CardPreviewMode; label: string }[] = [
  { value: "hover", label: "Hover" },
  { value: "right-click", label: "Right click" },
];
const PROMPT_PREVIEW_OPTIONS: ReadonlyArray<{ value: InlineCardStyle; label: string }> = [
  { value: "printed", label: "Realistic" },
  { value: "rules", label: "Rules" },
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
function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border bg-muted/10 p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function GameSettingsModal({ onClose }: { onClose: () => void }) {
  const prefs = usePreferencesStore();
  const fullControl = usePromptPreferencesStore((s) => s.fullControl);
  const setFullControl = usePromptPreferencesStore((s) => s.setFullControl);

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <Modal.Header onClose={onClose}>
        <h2 className="text-base font-semibold">Board settings</h2>
      </Modal.Header>
      <Modal.Body className="space-y-6">
        <SettingsSection title="Cards and prompts">
          <SettingRow
            label="Sort hand"
            hint="Manual lets you drag cards sideways. Color and mana value keep new cards sorted automatically."
          >
            <div className="flex flex-wrap items-center gap-2">
              {HAND_ORDER_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={prefs.handOrderMode === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setHandOrderMode(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label="Hand card style"
            hint="Printed card shows the card image. Dynamic view uses the card's current rules and game state; each card can still be switched."
          >
            <div className="flex items-center gap-2">
              {INLINE_CARD_STYLE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={prefs.handCardStyle === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setHandCardStyle(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label="Default stack card view"
            hint="Choose which face stack cards show when they appear. You can still switch individual cards."
          >
            <div className="flex items-center gap-2">
              {INLINE_CARD_STYLE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={prefs.stackCardStyle === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setStackCardStyle(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label="Prompt default preview"
            hint="Choose which face cards show when a prompt opens. You can still switch individual cards."
          >
            <div className="flex items-center gap-2">
              {PROMPT_PREVIEW_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={prefs.promptCardStyle === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setPromptCardStyle(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label="Card preview style"
            hint="Printed card shows the full card image. Dynamic view prioritizes current rules, actions, costs, counters, and other game state."
          >
            <div className="flex items-center gap-2">
              {IN_GAME_CARD_PREVIEW_STYLE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={prefs.inGameCardPreviewStyle === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => prefs.setInGameCardPreviewStyle(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </SettingRow>
        </SettingsSection>

        <SettingsSection title="Priority">
          <SettingRow
            label="Priority windows"
            hint="Autopass skips windows where you can only tap for mana, after a short delay. Full control stops at every window."
          >
            <div className="flex items-center gap-2">
              <Button
                variant={!fullControl ? "default" : "outline"}
                size="sm"
                onClick={() => setFullControl(false)}
              >
                Autopass
              </Button>
              <Button
                variant={fullControl ? "default" : "outline"}
                size="sm"
                onClick={() => setFullControl(true)}
              >
                Full control
              </Button>
            </div>
          </SettingRow>
        </SettingsSection>

        <SettingsSection title="Board appearance">
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
              {BATTLEFIELD_CARD_STYLE_OPTIONS.map((s) => (
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
            label="Opponent layout"
            hint="Focus on one opponent, or keep every opponent field equally visible."
          >
            <div className="flex items-center gap-2">
              <Button
                variant={prefs.opponentLayout === "focused" ? "default" : "outline"}
                size="sm"
                onClick={() => prefs.setOpponentLayout("focused")}
              >
                Focused
              </Button>
              <Button
                variant={prefs.opponentLayout === "overview" ? "default" : "outline"}
                size="sm"
                onClick={() => prefs.setOpponentLayout("overview")}
              >
                Overview
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
        </SettingsSection>

        <SettingsSection title="Prompts and input">
          <SettingRow
            label="Order triggers"
            hint="Prompt to choose the order when several of your triggers happen at once. Off orders them randomly."
          >
            <div className="flex items-center gap-2">
              <Button
                variant={prefs.chooseOrderOnMultipleTriggers ? "default" : "outline"}
                size="sm"
                onClick={() => prefs.setChooseOrderOnMultipleTriggers(true)}
              >
                On
              </Button>
              <Button
                variant={!prefs.chooseOrderOnMultipleTriggers ? "default" : "outline"}
                size="sm"
                onClick={() => prefs.setChooseOrderOnMultipleTriggers(false)}
              >
                Off
              </Button>
            </div>
          </SettingRow>

          <SettingRow
            label="Card preview trigger"
            hint="Hover opens automatically. Right click opens a preview that stays until dismissed."
          >
            <div className="flex flex-wrap items-center gap-2">
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
            hint="How long hover previews wait before appearing."
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
        </SettingsSection>
      </Modal.Body>
      <Modal.Footer>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
