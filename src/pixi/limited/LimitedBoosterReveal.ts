import { Container, Graphics, Text } from "pixi.js";
import { gsap } from "@/pixi/effects/gsap";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";

export interface RevealCard {
  motion: Container;
  x: number;
  y: number;
  width: number;
  height: number;
}
export class LimitedBoosterReveal {
  private timeline: gsap.core.Timeline | null = null;
  private wrapper: Container | null = null;
  private cards: RevealCard[] = [];
  private readonly stage: Container;
  private readonly request: () => void;
  constructor(stage: Container, request: () => void) {
    this.stage = stage;
    this.request = request;
  }
  get active(): boolean {
    return this.timeline !== null;
  }
  play(cards: RevealCard[], width: number, height: number): void {
    this.finish();
    if (!cards.length || !animationsEnabled()) return;
    this.cards = cards;
    const theme = getTheme();
    const centerX = width / 2;
    const centerY = Math.min(height / 2, cards[0].height / 2 + 40);
    const wrapper = new Container();
    wrapper.eventMode = "none";
    wrapper.position.set(centerX, centerY);
    wrapper.zIndex = 4;
    const wrapperWidth = cards[0].width + 20;
    const wrapperHeight = cards[0].height + 24;
    const upper = new Container();
    upper.addChild(
      new Graphics()
        .rect(-wrapperWidth / 2, -wrapperHeight / 2, wrapperWidth, wrapperHeight / 2)
        .fill(hexToNum(theme.appTheme.muted)),
    );
    const lower = new Graphics()
      .rect(-wrapperWidth / 2, 0, wrapperWidth, wrapperHeight / 2)
      .fill(hexToNum(theme.appTheme.muted));
    const seam = new Graphics()
      .rect(-wrapperWidth / 2, -2, wrapperWidth, 4)
      .fill(hexToNum(theme.gameTheme.cardRing));
    const title = new Text({
      text: "BOOSTER",
      style: {
        fontFamily: "Alegreya Sans",
        fontSize: 18,
        fontWeight: "bold",
        fill: theme.appTheme.foreground,
      },
    });
    title.anchor.set(0.5);
    upper.addChild(title);
    title.position.set(0, -wrapperHeight / 4);
    wrapper.addChild(upper, lower, seam);
    this.stage.addChild(wrapper);
    this.wrapper = wrapper;
    cards.forEach(({ motion, x, y, width: cardWidth, height: cardHeight }, index) => {
      motion.position.set(centerX - x - cardWidth / 2, centerY - y - cardHeight / 2 + index * 2);
      motion.scale.set(0.82);
      motion.rotation = (index - cards.length / 2) * 0.008;
      motion.alpha = 0;
    });
    const timeline = gsap.timeline({ onUpdate: this.request, onComplete: () => this.finish() });
    this.timeline = timeline;
    timeline.to(
      upper,
      { y: -wrapperHeight * 0.6, rotation: -0.14, alpha: 0, duration: 0.55, ease: "power2.in" },
      0.15,
    );
    timeline.to(
      lower,
      { y: wrapperHeight * 0.65, rotation: 0.12, alpha: 0, duration: 0.55, ease: "power2.in" },
      0.15,
    );
    timeline.to(seam, { alpha: 0, duration: 0.2 }, 0.15);
    cards.forEach(({ motion }, index) => {
      timeline.to(motion, { alpha: 1, duration: 0.2 }, 0.22 + index * 0.025);
      timeline.to(
        motion,
        {
          x: (index - (cards.length - 1) / 2) * 8,
          y: -12,
          rotation: (index - (cards.length - 1) / 2) * 0.015,
          duration: 0.5,
          ease: "power3.out",
        },
        0.28 + index * 0.025,
      );
      timeline.to(
        motion.scale,
        { x: 1, y: 1, duration: 0.5, ease: "power3.out" },
        0.28 + index * 0.025,
      );
      timeline.to(
        motion,
        { x: 0, y: 0, rotation: 0, duration: 0.35, ease: "power2.out" },
        0.8 + index * 0.025,
      );
    });
    this.request();
  }
  finish(): void {
    this.timeline?.kill();
    this.timeline = null;
    for (const { motion } of this.cards) {
      if (motion.destroyed) continue;
      motion.position.set(0, 0);
      motion.scale.set(1);
      motion.rotation = 0;
      motion.alpha = 1;
    }
    this.cards = [];
    this.wrapper?.removeFromParent();
    this.wrapper?.destroy({ children: true });
    this.wrapper = null;
    this.request();
  }
}
