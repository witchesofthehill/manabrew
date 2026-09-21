export const DRAG_LIFT_SCALE = 1.035;

const DRAG_POSITION_HALF_LIFE_MS = 18;
const DRAG_TRANSFORM_HALF_LIFE_MS = 36;
const DRAG_MAX_TILT_RADIANS = (10 * Math.PI) / 180;
const DRAG_TILT_RADIANS_PER_PIXEL = 0.017;
const MAX_DRAG_DELTA_MS = 50;

const halfLifeBlend = (deltaMs: number, halfLifeMs: number): number =>
  1 - Math.pow(0.5, Math.min(deltaMs, MAX_DRAG_DELTA_MS) / halfLifeMs);

export const dragPositionBlend = (deltaMs: number): number =>
  halfLifeBlend(deltaMs, DRAG_POSITION_HALF_LIFE_MS);

export const dragTransformBlend = (deltaMs: number): number =>
  halfLifeBlend(deltaMs, DRAG_TRANSFORM_HALF_LIFE_MS);

export const dragTiltForMovement = (movementX: number): number =>
  Math.max(
    -DRAG_MAX_TILT_RADIANS,
    Math.min(DRAG_MAX_TILT_RADIANS, movementX * DRAG_TILT_RADIANS_PER_PIXEL),
  );
