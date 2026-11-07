import { BlurFilter, Container, Graphics, GraphicsPath } from "pixi.js";
import { animationsEnabled } from "@/pixi/effects/enabled";

const BREATH_MS = 3600;

export interface PromptPanelShape {
  width: number;
  height: number;
  radius: number;
  squareBottom: boolean;
  tab?: { x: number; width: number; height: number; radius: number };
}

export function promptPanelOutline(shape: PromptPanelShape): string {
  const { width, height, radius, squareBottom, tab } = shape;
  const bottom = squareBottom ? 0 : radius;
  const tabRadius = tab ? Math.min(tab.radius, tab.height) : 0;
  const top =
    tab && tab.height > 0
      ? `H ${tab.x} V ${-tab.height + tabRadius}
       Q ${tab.x},${-tab.height} ${tab.x + tabRadius},${-tab.height}
       H ${tab.x + tab.width - tabRadius}
       Q ${tab.x + tab.width},${-tab.height} ${tab.x + tab.width},${-tab.height + tabRadius}
       V 0`
      : "";
  return `M ${radius},0 ${top} H ${width - radius} Q ${width},0 ${width},${radius}
    V ${height - bottom} Q ${width},${height} ${width - bottom},${height}
    H ${bottom} Q 0,${height} 0,${height - bottom}
    V ${radius} Q 0,0 ${radius},0 Z`;
}

interface PromptGlowOptions extends PromptPanelShape {
  color: number;
}

export class PromptGlow extends Container {
  readonly spill = new Graphics();
  private readonly halo = new Graphics();
  private readonly edge = new Graphics();
  private elapsed = 0;
  private readonly options: PromptGlowOptions;

  constructor(options: PromptGlowOptions) {
    super();
    this.options = options;
    this.eventMode = "none";
    this.spill.eventMode = "none";
    this.spill.filters = [new BlurFilter({ strength: 14 })];
    this.addChild(this.halo, this.edge);
    this.draw();
  }

  setHeight(height: number): void {
    this.options.height = height;
    this.draw();
  }

  redraw(): void {
    this.draw();
  }

  private draw(): void {
    const { color } = this.options;
    const path = new GraphicsPath(promptPanelOutline(this.options));
    this.spill.clear().path(path).stroke({ color, width: 20 });
    this.halo
      .clear()
      .path(path)
      .stroke({ color, width: 6, alpha: 0.12 })
      .path(path)
      .stroke({ color, width: 3, alpha: 0.32 });
    this.edge.clear().path(path).stroke({ color, width: 1 });

    this.update(this.elapsed);
  }

  update(elapsed: number): void {
    this.elapsed = elapsed;
    const animated = animationsEnabled();
    const breath = animated ? (1 - Math.cos((elapsed / BREATH_MS) * Math.PI * 2)) / 2 : 0;
    this.spill.alpha = 0.1 + breath * 0.12;
    this.halo.alpha = 0.4 + breath * 0.15;
    this.edge.alpha = 0.55 + breath * 0.2;
  }

  override destroy(): void {
    super.destroy({ children: true });
  }
}
