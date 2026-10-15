import { Container, FillGradient, Graphics, type DestroyOptions } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { withAlpha } from "@/themes/gameTheme";
import { animationsEnabled } from "./enabled";

const FOIL_PERIOD_MS = 6400;
const FOIL_TRAVEL = 0.65;

export class CardFoil extends Container {
  private readonly sheen = new Graphics();
  private readonly clip = new Graphics();
  private gradient: FillGradient | null = null;
  private surfaceKey = "";
  private surfaceWidth = 0;
  private readonly unsubscribePreferences: () => void;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly requestRender: () => void;

  constructor(requestRender: () => void) {
    super();
    this.requestRender = requestRender;
    this.eventMode = "none";
    this.interactiveChildren = false;
    this.visible = false;
    this.sheen.blendMode = "screen";
    this.addChild(this.sheen, this.clip);
    this.sheen.mask = this.clip;
    this.unsubscribePreferences = usePreferencesStore.subscribe((state, previous) => {
      if (state.inGameAnimations !== previous.inGameAnimations) this.requestRender();
    });
    this.reducedMotion.addEventListener("change", this.requestRender);
    this.onRender = () => {
      if (this.destroyed || !this.visible || !this.renderable || document.hidden) return;
      const animated = animationsEnabled() && usePreferencesStore.getState().inGameAnimations;
      for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.visible || !ancestor.renderable || ancestor.alpha <= 0) return;
      }
      const shift = animated
        ? Math.sin((performance.now() / FOIL_PERIOD_MS) * Math.PI * 2) * FOIL_TRAVEL
        : 0;
      this.sheen.x = this.surfaceWidth * (shift - 1);
      if (animated) this.requestRender();
    };
  }

  setSurface(width: number, height: number, radius: number, theme: Theme): void {
    const colors = theme.gameTheme;
    const key = `${width}:${height}:${radius}:${colors.canvas.neutral}:${colors.rarity.rare}:${colors.mana.U}:${colors.rarity.special}`;
    if (key === this.surfaceKey) return;
    this.surfaceKey = key;
    this.surfaceWidth = width;
    this.sheen.clear();
    this.gradient?.destroy();
    this.gradient = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0.45 },
      colorStops: [
        { offset: 0, color: withAlpha(colors.mana.U, 0.03) },
        { offset: 0.3, color: withAlpha(colors.rarity.special, 0.06) },
        { offset: 0.42, color: withAlpha(colors.mana.U, 0.2) },
        { offset: 0.5, color: withAlpha(colors.canvas.neutral, 0.26) },
        { offset: 0.58, color: withAlpha(colors.rarity.rare, 0.22) },
        { offset: 0.7, color: withAlpha(colors.rarity.special, 0.08) },
        { offset: 1, color: withAlpha(colors.mana.U, 0.03) },
      ],
    });
    this.sheen.rect(0, 0, width * 3, height).fill(this.gradient);
    this.sheen.x = -width;
    this.clip.clear().roundRect(0, 0, width, height, radius).fill(colors.canvas.neutral);
    this.requestRender();
  }

  setEnabled(enabled: boolean): void {
    if (this.visible === enabled) return;
    this.visible = enabled;
    this.requestRender();
  }

  override destroy(_options?: DestroyOptions): void {
    this.onRender = null;
    super.destroy({ children: true });
    this.gradient?.destroy();
    this.gradient = null;
    this.unsubscribePreferences();
    this.reducedMotion.removeEventListener("change", this.requestRender);
  }
}
