export interface BattlefieldLayoutPolicy {
  compact: boolean;
  selfBattlefieldRows: number;
  opponentBattlefieldRows: number;
  selfFieldShare: number;
  opponentCardScaleRatio: number;
  reserveHandSpace: boolean;
  handPresentation: "inline" | "sheet";
  showPhaseDivider: boolean;
}

export const DESKTOP_BATTLEFIELD_LAYOUT = {
  compact: false,
  selfBattlefieldRows: 3,
  opponentBattlefieldRows: 3,
  selfFieldShare: 0.5,
  opponentCardScaleRatio: 1,
  reserveHandSpace: true,
  handPresentation: "inline",
  showPhaseDivider: true,
} as const satisfies BattlefieldLayoutPolicy;

export const MOBILE_BATTLEFIELD_LAYOUT = {
  compact: true,
  selfBattlefieldRows: 2,
  opponentBattlefieldRows: 1,
  selfFieldShare: 0.6,
  opponentCardScaleRatio: 1,
  reserveHandSpace: false,
  handPresentation: "sheet",
  showPhaseDivider: false,
} as const satisfies BattlefieldLayoutPolicy;
