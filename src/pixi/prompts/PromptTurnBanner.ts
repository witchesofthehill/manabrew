import { Container, FillGradient, Graphics, Sprite, SplitText, Text, TextStyle } from "pixi.js";
import { TURN_HANDOFF_MS } from "@/components/game/game.constants";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum, mixNum } from "@/pixi/colorUtils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import { cachedAvatarTexture } from "@/pixi/hud/avatarTextureCache";
import { readableTextColor } from "@/themes/gameTheme";
import { DISPLAY_FONT_FAMILY } from "@/themes/typography";
import type { TurnHandoffSpec } from "./prompt.types";

export const TURN_IMPACT_SECONDS = 0.4;

const TOTAL_SECONDS = TURN_HANDOFF_MS / 1000;
const RAILS_AT = 0.1;
const TITLE_AT = 0.5;
const CREST_AT = 0.6;
const EXIT_AT = TOTAL_SECONDS - 0.45;
const FONT_HEIGHT_SHARE = 0.11;
const FONT_WIDTH_SHARE = 0.075;
const BAND_FONT_RATIO = 2.1;
const BLADE_WIDTH_SHARE = 0.42;
const RAIL_WIDTH_SHARE = 0.49;
const TIP_BAND_RATIO = 0.55;
const AVATAR_BAND_RATIO = 0.38;
const AVATAR_RING = 3;
const Z_INDEX = 9_998;

function bladePoints(half: number, halfHeight: number, tip: number): number[] {
  return [
    -half,
    0,
    tip - half,
    -halfHeight,
    half - tip,
    -halfHeight,
    half,
    0,
    half - tip,
    halfHeight,
    tip - half,
    halfHeight,
  ];
}

export class PromptTurnBanner {
  readonly container = new Container();
  private readonly onFrame: () => void;
  private timeline: gsap.core.Timeline | null = null;
  private gradient: FillGradient | null = null;

  constructor(onFrame: () => void) {
    this.onFrame = onFrame;
    this.container.eventMode = "none";
    this.container.zIndex = Z_INDEX;
    this.container.visible = false;
  }

  show(theme: Theme, handoff: TurnHandoffSpec, width: number, height: number): void {
    this.clear();
    const { label, turn, color, avatarUrl } = handoff;
    const fontSize = Math.round(Math.min(height * FONT_HEIGHT_SHARE, width * FONT_WIDTH_SHARE));
    const bandHeight = fontSize * BAND_FONT_RATIO;
    const halfHeight = bandHeight / 2;
    const half = width * BLADE_WIDTH_SHARE;
    const tip = bandHeight * TIP_BAND_RATIO;
    const surface = theme.gameTheme.phaseStrip.background;
    const surfaceFill = hexToNum(surface);
    const seat = hexToNum(color);
    const ink = hexToNum(
      readableTextColor(surface, theme.gameTheme.canvas.shadow, theme.gameTheme.textOnTinted),
    );
    const edgeFill = mixNum(surfaceFill, seat, 0.16);
    const coreFill = mixNum(surfaceFill, seat, 0.34);
    const accent = mixNum(seat, ink, 0.45);

    this.gradient = new FillGradient({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      colorStops: [
        { offset: 0, color: edgeFill },
        { offset: 0.5, color: coreFill },
        { offset: 1, color: edgeFill },
      ],
    });
    const body = new Graphics().poly(bladePoints(half, halfHeight, tip)).fill(this.gradient);

    const title = new SplitText({
      text: label,
      style: {
        fontFamily: DISPLAY_FONT_FAMILY,
        fontSize,
        fontWeight: "700",
        fill: ink,
        letterSpacing: 1,
        dropShadow: {
          color: seat,
          alpha: 1,
          angle: Math.PI / 2,
          blur: 0,
          distance: Math.max(2, fontSize * 0.05),
        },
      },
    });
    const titleBounds = title.getLocalBounds();
    const avatarTexture = avatarUrl ? cachedAvatarTexture(avatarUrl) : null;
    const avatarRadius = bandHeight * AVATAR_BAND_RATIO;
    const avatarSpace = avatarTexture ? avatarRadius * 2 + fontSize * 0.4 : 0;
    const titleRoom = (half - tip - avatarSpace) * 2;
    const titleScale = Math.min(1, titleRoom / titleBounds.width);
    title.pivot.set(titleBounds.x + titleBounds.width / 2, titleBounds.y + titleBounds.height / 2);
    title.scale.set(titleScale);
    title.y = fontSize * 0.08;

    const clip = new Graphics().poly(bladePoints(half, halfHeight, tip)).fill({ color: seat });
    const clipped = new Container();
    clipped.addChild(title);
    clipped.mask = clip;
    const blade = new Container();
    blade.addChild(body, clipped, clip);

    const avatar = new Container();
    if (avatarTexture) {
      const ring = new Graphics().circle(0, 0, avatarRadius + AVATAR_RING).fill({ color: accent });
      const photo = new Sprite(avatarTexture);
      const cover = (avatarRadius * 2) / Math.min(avatarTexture.width, avatarTexture.height);
      photo.anchor.set(0.5);
      photo.scale.set(cover);
      const photoMask = new Graphics().circle(0, 0, avatarRadius).fill({ color: seat });
      photo.mask = photoMask;
      avatar.addChild(ring, photo, photoMask);
      avatar.x = avatarRadius - avatarSpace - (titleBounds.width * titleScale) / 2;
      blade.addChild(avatar);
    }

    const railY = halfHeight + fontSize * 0.2;
    const railReach = width * RAIL_WIDTH_SHARE;
    const rails = new Graphics();
    for (const y of [-railY, railY]) {
      rails.poly([-railReach, y, 0, y - 2, railReach, y, 0, y + 2]).fill({ color: accent });
    }

    const crestRadius = fontSize * 0.62;
    const crest = new Container();
    crest.y = -halfHeight;
    const crestShape = new Graphics()
      .poly([0, -crestRadius, crestRadius, 0, 0, crestRadius, -crestRadius, 0])
      .fill({ color: seat })
      .stroke({ color: accent, width: 3, alignment: 1 });
    const crestInk = hexToNum(
      readableTextColor(color, theme.gameTheme.canvas.shadow, theme.gameTheme.textOnTinted),
    );
    const turnText = new Text({
      text: String(turn),
      style: new TextStyle({
        fontFamily: DISPLAY_FONT_FAMILY,
        fontSize: Math.round(crestRadius * 0.85),
        fontWeight: "700",
        fill: crestInk,
      }),
    });
    turnText.anchor.set(0.5);
    turnText.scale.set(Math.min(1, crestRadius / turnText.width));
    crest.addChild(crestShape, turnText);

    this.container.addChild(rails, blade, crest);
    this.container.position.set(width / 2, height / 2);
    this.container.visible = true;

    if (!animationsEnabled()) {
      this.timeline = gsap.timeline({ onComplete: () => this.clear() });
      this.timeline.to({}, { duration: TOTAL_SECONDS });
      this.onFrame();
      return;
    }

    const timeline = gsap.timeline({ onUpdate: this.onFrame, onComplete: () => this.clear() });
    this.timeline = timeline;
    timeline
      .fromTo(
        rails.scale,
        { x: 0 },
        { x: 1, duration: TURN_IMPACT_SECONDS - RAILS_AT, ease: "power3.out" },
        RAILS_AT,
      )
      .fromTo(
        blade.scale,
        { y: 0 },
        { y: 1, duration: 0.3, ease: "back.out(1.7)" },
        TURN_IMPACT_SECONDS,
      )
      .from(
        title.chars,
        {
          y: `+=${bandHeight}`,
          duration: 0.32,
          ease: "back.out(1.6)",
          stagger: { amount: 0.25 },
        },
        TITLE_AT,
      )
      .fromTo(
        crest.scale,
        { x: 0, y: 0 },
        { x: 1, y: 1, duration: 0.3, ease: "back.out(2.2)" },
        CREST_AT,
      )
      .fromTo(
        avatar.scale,
        { x: 0, y: 0 },
        { x: 1, y: 1, duration: 0.3, ease: "back.out(2.2)" },
        CREST_AT,
      )
      .fromTo(
        crest,
        { rotation: -Math.PI / 2 },
        { rotation: 0, duration: 0.3, ease: "power2.out" },
        CREST_AT,
      )
      .to(
        title.chars,
        {
          y: `-=${bandHeight}`,
          duration: 0.2,
          ease: "power2.in",
          stagger: { amount: 0.12 },
        },
        EXIT_AT,
      )
      .to(crest.scale, { x: 0, y: 0, duration: 0.18, ease: "back.in(2)" }, EXIT_AT)
      .to(avatar.scale, { x: 0, y: 0, duration: 0.18, ease: "back.in(2)" }, EXIT_AT)
      .to(blade.scale, { y: 0, duration: 0.2, ease: "power3.in" }, EXIT_AT + 0.18)
      .to(rails.scale, { x: 0, duration: 0.25, ease: "power3.in" }, EXIT_AT + 0.2);

    this.onFrame();
  }

  destroy(): void {
    this.timeline?.kill();
    this.container.destroy({ children: true });
    this.gradient?.destroy();
  }

  private clear(): void {
    this.timeline?.kill();
    this.timeline = null;
    this.container.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.gradient?.destroy();
    this.gradient = null;
    this.container.visible = false;
    this.onFrame();
  }
}
