import type { CardChoiceDto } from "@/protocol/game";
import { cn } from "@/lib/utils";
import { DEV_CARD_CHOICE_KINDS, useGameDevStore } from "@/stores/useGameDevStore";
import {
  DEV_CONTROL_ACTIVE,
  DEV_CONTROL_BUTTON,
  DEV_CONTROL_INACTIVE,
  DEV_SECTION_HEADING,
} from "./devPanel.styles";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
const CHOICE_LABELS: Record<CardChoiceDto["kind"], string> = {
  get color() {
    return i18n._(msg`Color \u00B7 Black`);
  },
  get type() {
    return i18n._(msg`Type \u00B7 Dragon`);
  },
  get namedCard() {
    return i18n._(msg`Named \u00B7 Black Vise`);
  },
  get chosenCard() {
    return i18n._(msg`Cards \u00B7 2`);
  },
  get number() {
    return i18n._(msg`Number \u00B7 7`);
  },
  get mode() {
    return i18n._(msg`Mode \u00B7 Abzan`);
  },
  get player() {
    return i18n._(msg`Player \u00B7 Opponent`);
  },
};
export function BattlefieldChoiceDevControls() {
  const selected = useGameDevStore((state) => state.debugCardChoices);
  const toggle = useGameDevStore((state) => state.toggleDebugCardChoice);
  const selectAll = useGameDevStore((state) => state.setAllDebugCardChoices);
  const clear = useGameDevStore((state) => state.clearDebugCardChoices);
  const selectedKinds = new Set(selected.map((choice) => choice.kind));
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={DEV_SECTION_HEADING}>
            <Trans>Persistent choices</Trans>
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {selected.length === 0
              ? i18n._(msg`No forced choices`)
              : i18n._(msg`${selected.length} forced`)}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-wide">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={selectAll}
          >
            <Trans>All</Trans>
          </button>
          {selected.length > 0 ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={clear}
            >
              <Trans>Clear all</Trans>
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {DEV_CARD_CHOICE_KINDS.map((kind) => {
          const active = selectedKinds.has(kind);
          return (
            <button
              key={kind}
              type="button"
              className={cn(
                DEV_CONTROL_BUTTON,
                "truncate px-2 py-1.5 text-[10px]",
                active ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
              )}
              onClick={() => toggle(kind)}
              title={CHOICE_LABELS[kind]}
            >
              {CHOICE_LABELS[kind]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
