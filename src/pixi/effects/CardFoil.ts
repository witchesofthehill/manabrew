import {
  Container,
  type Mesh,
  Point,
  type DestroyOptions,
  type FederatedPointerEvent,
  type MeshGeometry,
  type Shader,
  type Texture,
  type Sprite,
} from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hasCardFinishEffects, resolveCardFinish, type CardFoilRegion } from "@/lib/cardFinish";
import type { CardCosmetics } from "@/protocol/deck";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useCardFinishPreview } from "@/stores/useCardFinishPreview";
import { createCardFoilShader, type CardFoilShader } from "./cardFoilShader";
import { animationsEnabled } from "./enabled";
import { gsap } from "./gsap";
import { CardFoilMesh } from "./cardFoilBatch";
import {
  DEFAULT_CARD_POSE,
  writeCardPoseNormal,
  type CardLightingMode,
  type CardPose,
} from "@/lib/cardLighting";

export class CardFoil extends Container {
  private finish: CardFoilShader | null = null;
  private sheen: Mesh<MeshGeometry, Shader> | null = null;
  private sweep: gsap.core.Tween | null = null;
  private readonly pose = { phase: 0 };
  private readonly localPointer = new Point();
  private pointerParent: Container | null = null;
  private hovered = false;
  private readonly unsubscribePreferences: () => void;
  private readonly unsubscribeFinish: () => void;
  private enabled = false;
  private hasTexture = false;
  private texture: Texture | null = null;
  private textureUvs?: Float32Array;
  private sourceSprite: Sprite | null = null;
  private sourceRenderable = true;
  private physicalFoil = false;
  private cosmetics?: CardCosmetics;
  private etched = false;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly requestRender: () => void;
  private lighting: CardLightingMode = "pointer";
  private readonly cardNormal = new Float32Array([0, 0, 1]);

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
    this.on("added", this.bindPointer);
    this.on("removed", this.bindPointer);
    this.onRender = () => {
      this.syncAnimation();
      this.finish?.update(this.canAnimate() ? performance.now() / 1000 : 0, this.hovered);
    };
  }

  private readonly bindPointer = (): void => {
    this.pointerParent?.off("pointermove", this.movePointer);
    this.pointerParent?.off("pointerleave", this.leavePointer);
    this.pointerParent = this.parent;
    this.pointerParent?.on("pointermove", this.movePointer);
    this.pointerParent?.on("pointerleave", this.leavePointer);
    this.hovered = false;
    this.syncAnimation();
  };

  private readonly movePointer = (event: FederatedPointerEvent): void => {
    if (!this.finish || !this.canAnimate()) return;
    event.getLocalPosition(this, this.localPointer);
    const { uSize, pointer } = this.finish.uniforms;
    this.hovered =
      this.localPointer.x >= 0 &&
      this.localPointer.y >= 0 &&
      this.localPointer.x <= uSize[0] &&
      this.localPointer.y <= uSize[1];
    if (!this.hovered) {
      this.syncAnimation();
      return;
    }
    pointer[0] = this.localPointer.x / uSize[0];
    pointer[1] = this.localPointer.y / uSize[1];
    this.requestRender();
  };

  private readonly leavePointer = (): void => {
    this.hovered = false;
    this.syncAnimation();
  };

  private surfaceVisible(): boolean {
    if (!this.visible || !this.parent || document.hidden) return false;
    if (!this.renderable || this.alpha <= 0) return false;
    for (let ancestor: Container | null = this.parent; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.visible || !ancestor.renderable || ancestor.alpha <= 0) return false;
    }
    return true;
  }

  private canAnimate(): boolean {
    return (
      this.surfaceVisible() &&
      animationsEnabled() &&
      usePreferencesStore.getState().inGameAnimations
    );
  }

  private readonly syncAnimation = (): void => {
    if (!this.finish) return;
    this.finish.setTexture(this.surfaceVisible() ? this.texture : null, this.textureUvs);
    if (this.sourceSprite)
      this.sourceSprite.renderable =
        this.sourceRenderable && !(this.visible && this.finish.uniforms.heatDeformation > 0);
    if (!this.canAnimate()) {
      this.sweep?.pause();
      if (
        (!animationsEnabled() || !usePreferencesStore.getState().inGameAnimations) &&
        (this.finish.uniforms.pointer[0] !== 0.5 || this.finish.uniforms.pointer[1] !== 0.5)
      ) {
        this.finish.uniforms.pointer.fill(0.5);
        this.requestRender();
      }
      return;
    }
    if (this.sweep) {
      this.sweep.resume();
      return;
    }
    this.sweep = gsap.to(this.pose, {
      phase: Math.PI * 2,
      duration: 6.4,
      ease: "none",
      repeat: -1,
      onUpdate: () => {
        if (!this.canAnimate()) {
          this.syncAnimation();
          return;
        }
        const pointer = this.finish!.uniforms.pointer;
        if (!this.hovered) {
          pointer[0] = 0.5 + Math.sin(this.pose.phase) * 0.18;
          pointer[1] = 0.5 + Math.sin(this.pose.phase * 2) * 0.12;
        }
        this.requestRender();
      },
    });
  };

  setSurface(width: number, height: number, radius: number, _theme: Theme): void {
    if (!this.finish) {
      this.finish = createCardFoilShader(this.requestRender);
      this.sheen = new CardFoilMesh(this.finish);
      this.finish.setLighting(this.lighting, this.cardNormal);
      this.addChild(this.sheen);
    }
    this.sheen!.scale.set(width, height);
    this.finish.uniforms.uSize.set([width, height]);
    this.finish.uniforms.uRadius = radius;
    this.syncFinish();
  }

  setTexture(texture: Texture | null, uvs?: Float32Array, sourceSprite?: Sprite): void {
    if (this.sourceSprite !== (sourceSprite ?? null)) {
      if (this.sourceSprite) this.sourceSprite.renderable = this.sourceRenderable;
      this.sourceSprite = sourceSprite ?? null;
      this.sourceRenderable = sourceSprite?.renderable ?? true;
    }
    this.hasTexture = !!texture && !texture.destroyed;
    this.texture = this.hasTexture ? texture : null;
    this.textureUvs = uvs;
    this.syncFinish();
  }

  setArtWindows(regions: readonly CardFoilRegion[]): void {
    this.finish?.setArtWindows(regions);
  }

  setExclusions(regions: readonly CardFoilRegion[]): void {
    this.finish?.setExclusions(regions);
  }
  setLighting(mode: CardLightingMode, pose?: CardPose): void {
    this.lighting = mode;
    writeCardPoseNormal(this.cardNormal, pose ?? DEFAULT_CARD_POSE);
    this.finish?.setLighting(mode, this.cardNormal);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.syncFinish();
  }

  setAppearance(foil: boolean, cosmetics?: CardCosmetics, etched = false): void {
    this.physicalFoil = foil;
    this.cosmetics = cosmetics;
    this.etched = etched;
    this.syncFinish();
  }

  private syncFinish(): void {
    const mode =
      useCardFinishPreview.getState().mode ??
      resolveCardFinish(this.physicalFoil, this.cosmetics, this.etched);
    this.finish?.setMode(mode, this.cosmetics);
    this.visible = this.enabled && this.hasTexture && hasCardFinishEffects(mode, this.cosmetics);
    this.syncAnimation();
    this.requestRender();
  }

  override destroy(_options?: DestroyOptions): void {
    if (this.sourceSprite) this.sourceSprite.renderable = this.sourceRenderable;
    this.onRender = null;
    this.sweep?.kill();
    this.pointerParent?.off("pointermove", this.movePointer);
    this.pointerParent?.off("pointerleave", this.leavePointer);
    this.off("added", this.bindPointer);
    this.off("removed", this.bindPointer);
    this.unsubscribePreferences();
    this.unsubscribeFinish();
    this.reducedMotion.removeEventListener("change", this.syncAnimation);
    document.removeEventListener("visibilitychange", this.syncAnimation);
    super.destroy({ children: true });
    this.finish?.destroy();
    this.finish = null;
  }
}
