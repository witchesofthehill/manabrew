import { ActionPickerModal } from "@/components/game/modals/AbilityPickerModal";
import type { DeckCard } from "@/protocol/deck";
import type { HandActionOption } from "@/stores/useGameUIStore";

interface PlayModePickerProps {
  card: DeckCard;
  options: HandActionOption[];
  onSelect: (option: HandActionOption) => void;
  onCancel: () => void;
}

export function PlayModePicker({ card, options, onSelect, onCancel }: PlayModePickerProps) {
  return (
    <ActionPickerModal
      card={card}
      title="Choose an action"
      options={options}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
