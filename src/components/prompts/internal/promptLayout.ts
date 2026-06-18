import type { PromptPresentation as PromptPresentationInput } from "@/protocol";

// Below this body-text length (and with no targets) the prompt reads better
// stacked and centered than spread across the wide two-column layout.
const VERTICAL_TEXT_THRESHOLD = 40;

export function isVerticalPresentation(presentation: PromptPresentationInput): boolean {
  return (
    presentation.targets.length === 0 && (presentation.text?.length ?? 0) < VERTICAL_TEXT_THRESHOLD
  );
}
