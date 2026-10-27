export const UI_FONT_FAMILY = '"Source Sans 3 Variable", system-ui, -apple-system, sans-serif';
export const DISPLAY_FONT_FAMILY = '"Alegreya Sans", system-ui, -apple-system, sans-serif';

export type UiTextRole = "body" | "label" | "meta" | "caption" | "input";

const typographyProperties = {
  body: "--text-ui-body",
  label: "--text-ui-label",
  meta: "--text-ui-meta",
  caption: "--text-ui-caption",
  input: "--text-ui-input",
  controlHeight: "--ui-control-height",
} as const;
const typographyKeys = Object.keys(typographyProperties) as (keyof typeof typographyProperties)[];
const typographySizes = { body: 0, label: 0, meta: 0, caption: 0, input: 0, controlHeight: 0 };
let typographyInitialized = false;
let touchUi = false;

export function refreshUiTypography(): boolean {
  const style = getComputedStyle(document.documentElement);
  const rootSize = Number.parseFloat(style.fontSize);
  let changed = false;
  for (const key of typographyKeys) {
    const value = Number.parseFloat(style.getPropertyValue(typographyProperties[key])) * rootSize;
    if (typographySizes[key] !== value) {
      typographySizes[key] = value;
      changed = true;
    }
  }
  const nextTouchUi = typographySizes.controlHeight / rootSize >= 2.75;
  changed ||= touchUi !== nextTouchUi;
  touchUi = nextTouchUi;
  typographyInitialized = true;
  return changed;
}

export function getUiFontSize(role: UiTextRole): number {
  if (!typographyInitialized) refreshUiTypography();
  return typographySizes[role];
}

export function getUiControlHeight(): number {
  if (!typographyInitialized) refreshUiTypography();
  return typographySizes.controlHeight;
}

export function isTouchUi(): boolean {
  if (!typographyInitialized) refreshUiTypography();
  return touchUi;
}
