import {
  Color,
  Container,
  Mesh,
  type DestroyOptions,
  type MeshGeometry,
  type Shader,
} from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { DEFAULT_CARD_FOIL_MODE } from "@/lib/cardFinish";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useCardFinishPreview } from "@/stores/useCardFinishPreview";
import { createCardFoilShader, type CardFoilShader } from "./cardFoilShader";
import { animationsEnabled } from "./enabled";
import { gsap } from "./gsap";

export class CardFoil extends Container {
  private finish: CardFoilShader | null = null;
  private sheen: Mesh<MeshGeometry, Shader> | null = null;
  private sweep: gsap.core.Tween | null = null;
  private readonly unsubscribePreferences: () => void;
  private readonly unsubscribeFinish: () => void;
  private enabled = false;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly requestRender: () => void;

  constructor(requestRender: () => void) {
    super();
    this.requestRender = requestRender;
    this.eventMode = "none";
    this.interactiveChildren = false;
    this.visible = false;
    this.unsubscribePreferences = usePreferencesStore.subscribe((state, previous) => {
      if (state.inGameAnimations !== previous.inGameAnimations) this.syncAnimation();
    });
    this.unsubscribeFinish = useCardFinishPreview.subscribe((state, previous) => {
      if (state.mode !== previous.mode) this.syncFinish();
    });
    this.reducedMotion.addEventListener("change", this.syncAnimation);
    document.addEventListener("visibilitychange", this.syncAnimation);
    this.on("removed", this.syncAnimation);
    this.onRender = this.syncAnimation;
  }

  private canAnimate(): boolean {
    if (
      !this.visible ||
      !this.parent ||
      document.hidden ||
      !animationsEnabled() ||
      !usePreferencesStore.getState().inGameAnimations
    )
      return false;
    for (let ancestor: Container | null = this.parent; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.visible || !ancestor.renderable || ancestor.alpha <= 0) return false;
    }
    return true;
  }

  private readonly syncAnimation = (): void => {
    if (!this.finish) return;
    if (!this.canAnimate()) {
      this.sweep?.pause();
      if (
        (!animationsEnabled() || !usePreferencesStore.getState().inGameAnimations) &&
        this.finish.uniforms.uPhase !== 0.5
      ) {
        this.finish.uniforms.uPhase = 0.5;
        this.sweep?.kill();
        this.sweep = null;
        this.requestRender();
      }
      return;
    }
    if (this.sweep) {
      this.sweep.resume();
      return;
    }
    this.sweep = gsap.fromTo(
      this.finish.uniforms,
      { uPhase: -1 },
      {
        uPhase: 2,
        duration: 3.2,
        ease: "sine.inOut",
        repeat: -1,
        immediateRender: false,
        onUpdate: () => {
          if (this.canAnimate()) this.requestRender();
          else this.syncAnimation();
        },
      },
    );
  };

  setSurface(width: number, height: number, radius: number, theme: Theme): void {
    if (!this.finish) {
      this.finish = createCardFoilShader();
      this.sheen = new Mesh({ geometry: this.finish.geometry, shader: this.finish.shader });
      this.sheen.blendMode = "screen";
      this.addChild(this.sheen);
    }
    this.sheen!.scale.set(width, height);
    const uniforms = this.finish.uniforms;
    uniforms.uSize[0] = width;
    uniforms.uSize[1] = height;
    uniforms.uRadius = radius;
    Color.shared.setValue(theme.gameTheme.rarity.rare).toRgbArray(uniforms.uWarm);
    Color.shared.setValue(theme.gameTheme.mana.U).toRgbArray(uniforms.uCool);
    Color.shared.setValue(theme.gameTheme.canvas.neutral).toRgbArray(uniforms.uNeutral);
    this.syncFinish();
  }

  setExclusion(region: { x: number; y: number; width: number; height: number } | null): void {
    const exclusion = this.finish?.uniforms.uExclusion;
    if (!exclusion) return;
    exclusion[0] = region?.x ?? 0;
    exclusion[1] = region?.y ?? 0;
    exclusion[2] = region?.width ?? 0;
    exclusion[3] = region?.height ?? 0;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.syncFinish();
  }

  private syncFinish(): void {
    const mode = useCardFinishPreview.getState().mode ?? DEFAULT_CARD_FOIL_MODE;
    this.visible = this.enabled && mode !== "regular";
    this.syncAnimation();
    this.requestRender();
  }

  override destroy(_options?: DestroyOptions): void {
    this.onRender = null;
    this.sweep?.kill();
    this.unsubscribePreferences();
    this.unsubscribeFinish();
    this.reducedMotion.removeEventListener("change", this.syncAnimation);
    document.removeEventListener("visibilitychange", this.syncAnimation);
    super.destroy({ children: true });
    this.finish?.destroy();
    this.finish = null;
  }
}
