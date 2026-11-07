import { Container, Graphics, Sprite, SplitText, Text, TextStyle } from "pixi.js";
import { TURN_HANDOFF_MS } from "@/components/game/game.constants";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum, mixNum } from "@/pixi/colorUtils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import { cachedAvatarTexture } from "@/pixi/hud/avatarTextureCache";
import { readableTextColor } from "@/themes/gameTheme";
import { DISPLAY_FONT_FAMILY } from "@/themes/typography";
import type { TurnHandoffSpec } from "./prompt.types";

export const TURN_IMPACT_SECONDS = 0.55;

const TOTAL_SECONDS = TURN_HANDOFF_MS / 1000;
const RAILS_AT = 0.1;
const TITLE_AT = TURN_IMPACT_SECONDS + 0.1;
const DETAIL_AT = TURN_IMPACT_SECONDS + 0.2;
const EXIT_AT = TOTAL_SECONDS - 0.45;
const FONT_HEIGHT_SHARE = 0.07;
const FONT_WIDTH_SHARE = 0.05;
const BAND_FONT_RATIO = 2.4;
const TURN_FONT_RATIO = 0.34;
const TURN_INK_MIX = 0.7;
const TURN_TOP_PAD_RATIO = 0.12;
const AVATAR_BAND_RATIO = 0.28;
const AVATAR_RING = 2;
const RAIL_HEIGHT = 2;
const EDGE_PAD = 24;
const Z_INDEX = 9_998;

export class PromptTurnBanner {
  readonly container = new Container();
  private readonly onFrame: () => void;
  private timeline: gsap.core.Timeline | null = null;

  constructor(onFrame: () => void) {
    this.onFrame = onFrame;
    this.container.eventMode = "none";
    this.container.zIndex = Z_INDEX;
    this.container.visible = false;
  }

  show(theme: Theme, handoff: TurnHandoffSpec, width: number, height: number): void {
    this.clear();
    const { label, round, color, avatarUrl } = handoff;
    const fontSize = Math.round(Math.min(height * FONT_HEIGHT_SHARE, width * FONT_WIDTH_SHARE));
    const bandHeight = fontSize * BAND_FONT_RATIO;
    const halfHeight = bandHeight / 2;
    const surface = theme.gameTheme.phaseStrip.background;
    const surfaceFill = hexToNum(surface);
    const seat = hexToNum(color);
    const ink = hexToNum(
      readableTextColor(surface, theme.gameTheme.canvas.shadow, theme.gameTheme.textOnTinted),
    );
    const strip = () => new Graphics().rect(-width / 2, -halfHeight, width, bandHeight);
    const body = strip().fill({ color: surfaceFill });

    const title = new SplitText({
      text: label,
      style: {
        fontFamily: DISPLAY_FONT_FAMILY,
        fontSize,
        fontWeight: "700",
        fill: ink,
      },
    });
    const turnText = new Text({
      text: `Turn ${round}`,
      style: new TextStyle({
        fontFamily: DISPLAY_FONT_FAMILY,
        fontSize: Math.round(fontSize * TURN_FONT_RATIO),
        fontWeight: "700",
        fill: mixNum(surfaceFill, ink, TURN_INK_MIX),
      }),
    });
    turnText.anchor.set(0.5);
    const titleBounds = title.getLocalBounds();
    const avatarTexture = avatarUrl ? cachedAvatarTexture(avatarUrl) : null;
    const avatarRadius = bandHeight * AVATAR_BAND_RATIO;
    const gap = fontSize * 0.5;
    const avatarSpace = avatarTexture ? avatarRadius * 2 + gap : 0;
    const titleRoom = width - (EDGE_PAD + avatarSpace) * 2;
    const titleScale = Math.min(1, titleRoom / titleBounds.width);
    const titleWidth = titleBounds.width * titleScale;
    title.pivot.set(titleBounds.x + titleBounds.width / 2, titleBounds.y + titleBounds.height / 2);
    title.scale.set(titleScale);
    title.y = fontSize * 0.08;

    const clip = strip().fill({ color: seat });
    const clipped = new Container();
    clipped.addChild(title);
    clipped.mask = clip;
    const band = new Container();
    band.addChild(body, clipped, clip);

    const avatar = new Container();
    if (avatarTexture) {
      const ring = new Graphics().circle(0, 0, avatarRadius + AVATAR_RING).fill({ color: seat });
      const photo = new Sprite(avatarTexture);
      const cover = (avatarRadius * 2) / Math.min(avatarTexture.width, avatarTexture.height);
      photo.anchor.set(0.5);
      photo.scale.set(cover);
      const photoMask = new Graphics().circle(0, 0, avatarRadius).fill({ color: seat });
      photo.mask = photoMask;
      avatar.addChild(ring, photo, photoMask);
      avatar.x = -titleWidth / 2 - gap - avatarRadius;
      band.addChild(avatar);
    }

    const rails = new Graphics();
    for (const y of [-halfHeight - RAIL_HEIGHT, halfHeight]) {
      rails.rect(-width / 2, y, width, RAIL_HEIGHT).fill({ color: seat });
    }

    const turnBadge = new Container();
    turnBadge.y = fontSize * TURN_TOP_PAD_RATIO + turnText.height / 2 - halfHeight;
    turnBadge.addChild(turnText);

    this.container.addChild(rails, band, turnBadge);
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
        band.scale,
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
        turnBadge.scale,
        { x: 0, y: 0 },
        { x: 1, y: 1, duration: 0.3, ease: "back.out(2.2)" },
        DETAIL_AT,
      )
      .fromTo(
        avatar.scale,
        { x: 0, y: 0 },
        { x: 1, y: 1, duration: 0.3, ease: "back.out(2.2)" },
        DETAIL_AT,
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
      .to(turnBadge.scale, { x: 0, y: 0, duration: 0.18, ease: "back.in(2)" }, EXIT_AT)
      .to(avatar.scale, { x: 0, y: 0, duration: 0.18, ease: "back.in(2)" }, EXIT_AT)
      .to(band.scale, { y: 0, duration: 0.2, ease: "power3.in" }, EXIT_AT + 0.18)
      .to(rails.scale, { x: 0, duration: 0.25, ease: "power3.in" }, EXIT_AT + 0.2);

    this.onFrame();
  }

  destroy(): void {
    this.timeline?.kill();
    this.container.destroy({ children: true });
  }

  private clear(): void {
    this.timeline?.kill();
    this.timeline = null;
    this.container.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.container.visible = false;
    this.onFrame();
  }
}
