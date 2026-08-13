export interface DeckEditorCommand {
  id: string;
  label: string;
  keywords?: string[];
  disabled?: boolean;
  disabledReason?: string;
  run: () => void;
}
