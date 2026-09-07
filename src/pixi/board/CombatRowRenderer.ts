import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { BattlefieldState } from "../types";
import { hexToNum } from "../colorUtils";
import { loadAvatarTexture } from "../hud/avatarTextureCache";
import { applyIcon } from "../panelIcons";
import { Z_COMBAT_STAGED } from "../constants";

const AVATAR_DIAMETER = 24;
const BOT_ICON = "robot-antennas";

type CombatRowGroup = NonNullable<BattlefieldState["combatRowGroups"]>[number];

interface CombatRowConnector {
  ax: number;
  bx: number;
  by: number;
}

export interface CombatRowRenderSpec {
  y: number;
  stripLeft: number;
  stripTop: number;
  stripWidth: number;
  stripHeight: number;
  mirrored: boolean;
  targetName: string;
  connectors: CombatRowConnector[];
  groups: CombatRowGroup[];
}

interface AvatarEntry {
  sprite: Sprite;
  mask: Graphics;
  url: string | null;
  size: number;
}

interface RenderSnapshot {
  y: number;
  stripLeft: number;
  stripTop: number;
  stripWidth: number;
  stripHeight: number;
  mirrored: boolean;
  targetName: string;
  attackColor: string;
  defenseColor: string;
  textColor: string;
  shadowColor: string;
  maskColor: string;
  connectors: readonly number[];
  groups: readonly string[];
}

export class CombatRowRenderer {
  private graphics = new Graphics();
  private labels: Text[] = [];
  private avatars: AvatarEntry[] = [];
  private snapshot: RenderSnapshot | null = null;
  private container: Container;

  constructor(container: Container) {
    this.container = container;
    this.graphics.eventMode = "none";
    this.graphics.zIndex = Z_COMBAT_STAGED - 5;
    this.container.addChild(this.graphics);
  }

  hide(): void {
    if (this.snapshot === null) return;
    this.snapshot = null;
    this.graphics.clear();
    for (const label of this.labels) label.visible = false;
    for (const avatar of this.avatars) avatar.sprite.visible = false;
  }

  render(spec: CombatRowRenderSpec, theme: Theme): void {
    if (this.matchesSnapshot(spec, theme)) return;
    const colors = theme.gameTheme;
    const priorSnapshot = this.snapshot;
    const labelThemeChanged =
      !priorSnapshot ||
      priorSnapshot.textColor !== colors.textOnTinted ||
      priorSnapshot.shadowColor !== colors.canvas.shadow;
    this.captureSnapshot(spec, theme);
    this.graphics.clear();
    for (const label of this.labels) label.visible = false;
    for (const avatar of this.avatars) avatar.sprite.visible = false;

    const attackColor = hexToNum(colors.promptAction.attackAction);
    this.graphics.roundRect(spec.stripLeft, spec.stripTop, spec.stripWidth, spec.stripHeight, 10);
    this.graphics.fill({ color: attackColor, alpha: 0.22 });
    this.graphics.roundRect(spec.stripLeft, spec.stripTop, spec.stripWidth, spec.stripHeight, 10);
    this.graphics.stroke({ color: attackColor, width: 1.5, alpha: 0.6 });

    if (spec.connectors.length > 0) {
      for (const connector of spec.connectors) {
        this.graphics.moveTo(connector.ax, spec.y);
        this.graphics.lineTo(connector.bx, connector.by);
      }
      this.graphics.stroke({
        color: hexToNum(colors.promptAction.defenseAction),
        width: 2,
        alpha: 0.55,
      });
    }

    const avatarDiameter = Math.min(AVATAR_DIAMETER, spec.stripHeight - 6);
    for (let index = 0; index < spec.groups.length; index++) {
      const group = spec.groups[index]!;
      const identityColor = hexToNum(group.color);
      const avatarX = spec.stripLeft + 6 + avatarDiameter / 2;
      const avatarY = spec.mirrored
        ? spec.stripTop + spec.stripHeight + 6 + avatarDiameter / 2 + index * (avatarDiameter + 4)
        : spec.stripTop + 6 + avatarDiameter / 2 + index * (avatarDiameter + 4);

      this.graphics.circle(avatarX, avatarY, avatarDiameter / 2);
      this.graphics.fill({ color: identityColor, alpha: 0.4 });
      this.graphics.circle(avatarX, avatarY, avatarDiameter / 2);
      this.graphics.stroke({ color: identityColor, width: 1.5 });

      const avatar = this.avatar(index);
      avatar.sprite.visible = true;
      avatar.sprite.position.set(avatarX, avatarY);
      avatar.mask.clear();
      avatar.mask.circle(avatarX, avatarY, avatarDiameter / 2 - 1);
      avatar.mask.fill({ color: hexToNum(colors.canvas.neutral) });
      if (group.avatarUrl) {
        this.loadAvatar(avatar, group.avatarUrl, avatarDiameter);
      } else {
        if (avatar.url !== null) {
          avatar.url = null;
          avatar.sprite.texture = Texture.EMPTY;
        }
        applyIcon(
          avatar.sprite,
          BOT_ICON,
          colors.textOnTinted,
          64,
          avatarDiameter * 0.7,
          avatarDiameter * 0.7,
        );
      }

      const label = this.label(index, theme, labelThemeChanged);
      const text = spec.targetName ? `${group.label} → ${spec.targetName}` : group.label;
      if (label.text !== text) label.text = text;
      label.position.set(avatarX + avatarDiameter / 2 + 6, avatarY);
      label.visible = true;
    }
  }

  private matchesSnapshot(spec: CombatRowRenderSpec, theme: Theme): boolean {
    const snapshot = this.snapshot;
    if (!snapshot) return false;
    const colors = theme.gameTheme;
    if (
      spec.y !== snapshot.y ||
      spec.stripLeft !== snapshot.stripLeft ||
      spec.stripTop !== snapshot.stripTop ||
      spec.stripWidth !== snapshot.stripWidth ||
      spec.stripHeight !== snapshot.stripHeight ||
      spec.mirrored !== snapshot.mirrored ||
      spec.targetName !== snapshot.targetName ||
      colors.promptAction.attackAction !== snapshot.attackColor ||
      colors.promptAction.defenseAction !== snapshot.defenseColor ||
      colors.textOnTinted !== snapshot.textColor ||
      colors.canvas.shadow !== snapshot.shadowColor ||
      colors.canvas.neutral !== snapshot.maskColor
    ) {
      return false;
    }
    if (spec.connectors.length * 3 !== snapshot.connectors.length) return false;
    for (let index = 0; index < spec.connectors.length; index++) {
      const connector = spec.connectors[index]!;
      const offset = index * 3;
      if (
        connector.ax !== snapshot.connectors[offset] ||
        connector.bx !== snapshot.connectors[offset + 1] ||
        connector.by !== snapshot.connectors[offset + 2]
      ) {
        return false;
      }
    }
    if (spec.groups.length * 3 !== snapshot.groups.length) return false;
    for (let index = 0; index < spec.groups.length; index++) {
      const group = spec.groups[index]!;
      const offset = index * 3;
      if (
        group.color !== snapshot.groups[offset] ||
        group.label !== snapshot.groups[offset + 1] ||
        (group.avatarUrl ?? "") !== snapshot.groups[offset + 2]
      ) {
        return false;
      }
    }
    return true;
  }

  private captureSnapshot(spec: CombatRowRenderSpec, theme: Theme): void {
    const connectors = spec.connectors.flatMap((connector) => [
      connector.ax,
      connector.bx,
      connector.by,
    ]);
    const groups = spec.groups.flatMap((group) => [
      group.color,
      group.label,
      group.avatarUrl ?? "",
    ]);
    const colors = theme.gameTheme;
    this.snapshot = {
      y: spec.y,
      stripLeft: spec.stripLeft,
      stripTop: spec.stripTop,
      stripWidth: spec.stripWidth,
      stripHeight: spec.stripHeight,
      mirrored: spec.mirrored,
      targetName: spec.targetName,
      attackColor: colors.promptAction.attackAction,
      defenseColor: colors.promptAction.defenseAction,
      textColor: colors.textOnTinted,
      shadowColor: colors.canvas.shadow,
      maskColor: colors.canvas.neutral,
      connectors,
      groups,
    };
  }

  private avatar(index: number): AvatarEntry {
    let avatar = this.avatars[index];
    if (!avatar) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.eventMode = "none";
      sprite.zIndex = Z_COMBAT_STAGED + 2;
      const mask = new Graphics();
      mask.eventMode = "none";
      sprite.mask = mask;
      this.container.addChild(mask, sprite);
      avatar = { sprite, mask, url: null, size: 0 };
      this.avatars[index] = avatar;
    }
    return avatar;
  }

  private loadAvatar(avatar: AvatarEntry, url: string, size: number): void {
    avatar.size = size;
    avatar.sprite.width = size;
    avatar.sprite.height = size;
    if (avatar.url === url) return;
    avatar.url = url;
    avatar.sprite.texture = Texture.EMPTY;
    loadAvatarTexture(url)
      .then((texture) => {
        if (avatar.sprite.destroyed || avatar.url !== url) return;
        avatar.sprite.texture = texture;
        avatar.sprite.width = avatar.size;
        avatar.sprite.height = avatar.size;
      })
      .catch(() => {});
  }

  private label(index: number, theme: Theme, themeChanged: boolean): Text {
    let label = this.labels[index];
    if (!label) {
      label = new Text({
        text: "",
        style: {
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 12,
          fontWeight: "800",
          fill: theme.gameTheme.textOnTinted,
          dropShadow: {
            color: theme.gameTheme.canvas.shadow,
            alpha: 0.6,
            blur: 3,
            distance: 1,
            angle: Math.PI / 2,
          },
        },
      });
      label.anchor.set(0, 0.5);
      label.eventMode = "none";
      label.zIndex = Z_COMBAT_STAGED + 2;
      this.container.addChild(label);
      this.labels[index] = label;
    } else if (themeChanged) {
      label.style.fill = theme.gameTheme.textOnTinted;
      label.style.dropShadow.color = theme.gameTheme.canvas.shadow;
    }
    return label;
  }
}
