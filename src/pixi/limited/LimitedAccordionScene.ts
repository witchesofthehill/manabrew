import { Container, Graphics } from "pixi.js";
import { getTheme, subscribeTheme } from "@/hooks/useTheme";
import { BattlefieldDividers } from "@/pixi/board/BattlefieldDividers";
import { collapsedOpponentWidth, DELIMITER_EASE } from "@/pixi/board/boardLayout";
import { lerp, setFrameRatio } from "@/pixi/board/pixiHelpers";
import { hexToNum } from "@/pixi/colorUtils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { acquireLimitedRenderer, type LimitedPane } from "@/pixi/limited/LimitedRenderer";

export class LimitedAccordionScene implements LimitedPane {
  readonly root = new Container();
  readonly layer = "decoration" as const;
  readonly host: HTMLElement;
  private readonly renderer;
  private readonly dividers;
  private readonly veil = new Graphics();
  private readonly observer: ResizeObserver;
  private readonly unsubscribeTheme: () => void;
  private current = [0.25, 0.5, 0.75];
  private target = [0.25, 0.5, 0.75];
  private open = [true, true, true, true];
  private width = 0;
  private height = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    this.root.addChild(this.veil);
    this.dividers = new BattlefieldDividers(getTheme(), () => this.renderer.request());
    this.root.addChild(this.dividers.root);
    this.renderer = acquireLimitedRenderer(this);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.unsubscribeTheme = subscribeTheme(() => {
      this.dividers.setTheme(getTheme());
      this.paint();
      this.renderer.request();
    });
    this.resize();
  }
  update(open: boolean[]): void {
    this.open = open;
    this.retarget();
    this.renderer.request();
  }
  private resize(): void {
    this.width = this.host.clientWidth;
    this.height = this.host.clientHeight;
    this.retarget();
    this.renderer.request();
  }
  private retarget(): void {
    const count = this.open.length;
    const expanded = this.open.filter(Boolean).length;
    const collapsed = collapsedOpponentWidth(this.width, count);
    const expandedWidth = expanded
      ? (this.width - (count - expanded) * collapsed) / expanded
      : collapsed;
    let edge = 0;
    this.target = this.open.slice(0, -1).map((open) => {
      edge += open ? expandedWidth : collapsed;
      return this.width ? edge / this.width : 0;
    });
    for (const section of this.host.querySelectorAll<HTMLElement>("[data-limited-section]")) {
      section.style.setProperty(
        "--limited-section-width",
        `${Math.max(collapsed, expandedWidth)}px`,
      );
    }
    this.paint();
  }
  readonly layout = (deltaMs: number): boolean => {
    setFrameRatio(deltaMs);
    let moving = false;
    for (let index = 0; index < this.target.length; index++) {
      const next = lerp(
        this.current[index],
        this.target[index],
        animationsEnabled() ? DELIMITER_EASE.FACTOR : 1,
        DELIMITER_EASE.SNAP,
      );
      moving ||= next !== this.current[index];
      this.current[index] = next;
    }
    if (moving) this.paint();
    return moving;
  };
  readonly frame = (): boolean => {
    this.dividers.setAnimated(animationsEnabled() && this.width > 0);
    return false;
  };
  private paint(): void {
    const sections = this.host.querySelectorAll<HTMLElement>("[data-limited-section]");
    const collapsed = collapsedOpponentWidth(this.width, this.open.length);
    const veilStart = collapsed * 2;
    const headerHeight = sections[0]?.querySelector("header")?.clientHeight ?? 0;
    const contentHeight = Math.max(0, this.height - headerHeight);
    this.dividers.root.y = headerHeight;
    this.veil.clear();
    sections.forEach((section, index) => {
      const left = Math.round((index === 0 ? 0 : this.current[index - 1]) * this.width);
      const right = Math.round(
        (index === this.open.length - 1 ? 1 : this.current[index]) * this.width,
      );
      const bandWidth = right - left;
      section.style.width = `${bandWidth}px`;
      const fraction = Math.max(0, Math.min(1, (veilStart - bandWidth) / (veilStart - collapsed)));
      if (fraction > 0.001)
        this.veil
          .rect(left, headerHeight, bandWidth, contentHeight)
          .fill({ color: hexToNum(getTheme().gameTheme.canvas.background), alpha: fraction });
    });
    this.dividers.draw(
      this.width,
      contentHeight,
      this.current,
      this.open.flatMap((open, index) => (open ? [index] : [])),
      collapsed,
    );
  }
  destroy(): void {
    this.observer.disconnect();
    this.unsubscribeTheme();
    this.dividers.destroy();
    this.renderer.release(this);
    this.root.destroy({ children: true });
  }
}
