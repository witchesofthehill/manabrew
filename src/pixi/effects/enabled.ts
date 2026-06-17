/**
 * Global gate for decorative in-game board animations (entrance stomp, dust,
 * stat/damage pops, glow pulses). Driven by the `inGameAnimations` preference
 * via `BoardCanvas`. A module singleton so the non-React Pixi code (regions,
 * sprites) can read it cheaply each frame without a store subscription.
 *
 * State indicators (rings, summoning dim, P/T colors, floaters) and functional
 * motion (card movement, hover) are NOT gated — only the decorative effects.
 */

let enabled = true;

export const animationsEnabled = (): boolean => enabled;

export const setAnimationsEnabled = (value: boolean): void => {
  enabled = value;
};
