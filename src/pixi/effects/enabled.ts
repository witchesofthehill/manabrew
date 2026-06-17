// Gates only decorative effects (stomp, dust, stat/damage pops, glow pulses), not
// state indicators (rings, dim, P/T colors, floaters) or functional motion (movement, hover).

let enabled = true;

export const animationsEnabled = (): boolean => enabled;

export const setAnimationsEnabled = (value: boolean): void => {
  enabled = value;
};
