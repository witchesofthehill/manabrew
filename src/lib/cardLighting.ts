import { normalLightingVersion } from "card-glint";
import type { Frame } from "card-glint";

export type CardLightingMode = NonNullable<Frame["lighting"]>;

export interface CardPose {
  readonly yaw: number;
  readonly pitch: number;
}

export const DEFAULT_CARD_POSE: CardPose = { yaw: 0, pitch: 0 };
export const CARD_NORMAL_LIGHTING_VERSION = normalLightingVersion;
export const MAX_CARD_TILT = 0.45;

export function writeCardPoseNormal(target: { [index: number]: number }, pose: CardPose): void {
  const cx = Math.cos(pose.pitch);
  target[0] = Math.sin(pose.yaw) * cx;
  target[1] = -Math.sin(pose.pitch);
  target[2] = Math.cos(pose.yaw) * cx;
}
