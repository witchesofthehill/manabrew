import { Container, Graphics, Matrix, Sprite, Texture, type DestroyOptions } from "pixi.js";
import {
  CARD_LIVE_PULSE,
  getCardLiveHighlights,
  type CardLiveHighlightLayers,
} from "@/lib/cardLiveHighlights";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { animationsEnabled, subscribeAnimationsEnabled } from "./enabled";
import { gsap } from "./gsap";
import { createGeneratedCardTexture } from "@/pixi/generatedCardTexture";
import type { CardRaster } from "@/lib/cardRenderTypes";
import { retainCardRaster } from "@/lib/cardRenderTypes";

export class CardLiveHighlight extends Container {
  private readonly surface = new Container();
  private readonly regions = new Container();
  private readonly sourceClip = new Graphics();
  private readonly inks: Sprite[] = [];
  private readonly ownedTextures: Texture[] = [];
  private readonly sourceMatrix = new Matrix();
  private readonly parentMatrix = new Matrix();
  private sourceSprite: Sprite | null = null;
  private sourceTexture: Texture | null = null;
  private layers: CardLiveHighlightLayers | undefined;
  private releaseRaster?: () => void;
  private pulse: gsap.core.Tween | null = null;
  private readonly breathing = { scale: CARD_LIVE_PULSE.minScale, offsetY: 0 };
  private readonly ancestors: Container[] = [];
  private renderRoot: Container | null = null;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly unsubscribePreferences: () => void;
  private readonly unsubscribeAnimations: () => void;
  private readonly requestRender: () => void;

  constructor(requestRender: () => void) {
    super();
    this.requestRender = requestRender;
    this.eventMode = "none";
    this.interactiveChildren = false;
    this.surface.visible = false;
    this.surface.addChild(this.regions, this.sourceClip);
    this.regions.mask = this.sourceClip;
    this.addChild(this.surface);
    this.unsubscribePreferences = usePreferencesStore.subscribe((state, previous) => {
      if (state.inGameAnimations !== previous.inGameAnimations) this.syncAnimation();
    });
    this.unsubscribeAnimations = subscribeAnimationsEnabled(this.syncAnimation);
    this.reducedMotion.addEventListener("change", this.syncAnimation);
    document.addEventListener("visibilitychange", this.syncAnimation);
    this.on("added", this.bindAncestors);
    this.on("removed", this.bindAncestors);
    this.on("visibleChanged", this.syncAnimation);
  }

  setSource(source: Sprite | null): void {
    const texture =
      source && !source.destroyed && !source.texture.destroyed ? source.texture : null;
    const resource: unknown = texture?.source.resource;
    const layers =
      resource && typeof resource === "object" ? getCardLiveHighlights(resource) : undefined;
    const nextSource = layers?.regions.length ? source : null;
    if (this.sourceSprite !== nextSource || this.sourceTexture !== (nextSource ? texture : null)) {
      this.sourceSprite?.off("visibleChanged", this.syncAnimation);
      this.sourceSprite?.off("destroyed", this.clearSource);
      this.sourceSprite?.off("added", this.bindAncestors);
      this.sourceSprite?.off("removed", this.bindAncestors);
      this.sourceTexture?.off("destroy", this.clearSource);
      this.sourceSprite = nextSource;
      this.sourceTexture = nextSource ? texture : null;
      this.sourceSprite?.on("visibleChanged", this.syncAnimation);
      this.sourceSprite?.on("destroyed", this.clearSource);
      this.sourceSprite?.on("added", this.bindAncestors);
      this.sourceSprite?.on("removed", this.bindAncestors);
      this.sourceTexture?.on("destroy", this.clearSource);
      this.bindAncestors();
    }
    if (this.layers !== layers) {
      this.regions.removeChildren().forEach((child) => child.destroy());
      this.inks.length = 0;
      for (const owned of this.ownedTextures) owned.destroy(true);
      this.ownedTextures.length = 0;
      this.releaseRaster?.();
      this.releaseRaster =
        nextSource && texture ? retainCardRaster(texture.source.resource as CardRaster) : undefined;
      this.layers = layers;
      if (nextSource && layers) {
        for (const region of layers.regions) {
          const paper = new Sprite(this.createTexture(region.paper));
          paper.position.set(region.x, region.y);
          this.regions.addChild(paper);
        }
        for (const region of layers.regions) {
          const ink = new Sprite(this.createTexture(region.ink));
          ink.anchor.set(0.5);
          ink.position.set(
            region.x + region.ink.width / 2,
            region.y + region.ink.height / 2 + this.breathing.offsetY,
          );
          ink.scale.set(this.breathing.scale);
          this.inks.push(ink);
          this.regions.addChild(ink);
        }
      } else {
        this.pulse?.kill();
        this.pulse = null;
        this.breathing.scale = CARD_LIVE_PULSE.minScale;
        this.breathing.offsetY = 0;
      }
    }
    this.mask = nextSource?.mask ?? null;
    if (nextSource && texture) {
      const { orig, frame, trim } = texture;
      const width = trim?.width ?? orig.width;
      const height = trim?.height ?? orig.height;
      this.regions.scale.set(width / frame.width, height / frame.height);
      this.regions.position.set(
        (trim?.x ?? 0) - (frame.x * width) / frame.width,
        (trim?.y ?? 0) - (frame.y * height) / frame.height,
      );
      this.sourceClip
        .clear()
        .rect(trim?.x ?? 0, trim?.y ?? 0, width, height)
        .fill();
      this.syncTransform();
    }
    this.onRender = nextSource ? this.surfaceRendered : null;
    this.syncAnimation();
    this.requestRender();
  }

  private createTexture(canvas: CardRaster): Texture {
    const texture = createGeneratedCardTexture(canvas);
    this.ownedTextures.push(texture);
    return texture;
  }

  private syncTransform(): void {
    const source = this.sourceSprite;
    if (!source || !this.parent) return;
    this.sourceMatrix.identity();
    for (let ancestor: Container | null = source; ancestor; ancestor = ancestor.parent) {
      ancestor.updateLocalTransform();
      this.sourceMatrix.prepend(ancestor.localTransform);
    }
    this.updateLocalTransform();
    this.parentMatrix.copyFrom(this.localTransform);
    for (let ancestor: Container | null = this.parent; ancestor; ancestor = ancestor.parent) {
      ancestor.updateLocalTransform();
      this.parentMatrix.prepend(ancestor.localTransform);
    }
    this.parentMatrix.invert().append(this.sourceMatrix);
    const anchorX = source.anchor.x * source.texture.orig.width;
    const anchorY = source.anchor.y * source.texture.orig.height;
    this.parentMatrix.tx -= this.parentMatrix.a * anchorX + this.parentMatrix.c * anchorY;
    this.parentMatrix.ty -= this.parentMatrix.b * anchorX + this.parentMatrix.d * anchorY;
    this.surface.setFromMatrix(this.parentMatrix);
    let alpha = source.alpha;
    for (let ancestor = source.parent; ancestor; ancestor = ancestor.parent)
      alpha *= ancestor.alpha;
    let parentAlpha = this.alpha;
    for (let ancestor: Container | null = this.parent; ancestor; ancestor = ancestor.parent)
      parentAlpha *= ancestor.alpha;
    this.surface.alpha = parentAlpha > 0 ? alpha / parentAlpha : 0;
  }

  private readonly surfaceRendered = (): void => {
    let root = this.parent;
    while (root?.parent) root = root.parent;
    const rootChanged = this.renderRoot !== root;
    this.renderRoot = root;
    if (!rootChanged && this.surface.visible === this.canAnimate()) return;
    queueMicrotask(() => {
      if (!this.destroyed) this.syncAnimation();
    });
  };

  private readonly clearSource = (): void => {
    this.setSource(null);
  };

  private readonly bindAncestors = (): void => {
    for (const ancestor of this.ancestors) {
      ancestor.off("visibleChanged", this.syncAnimation);
      ancestor.off("added", this.bindAncestors);
      ancestor.off("removed", this.bindAncestors);
    }
    this.ancestors.length = 0;
    if (this.sourceSprite) {
      this.watchAncestors(this.parent);
      this.watchAncestors(this.sourceSprite.parent);
    }
    this.syncAnimation();
    this.requestRender();
  };

  private watchAncestors(parent: Container | null): void {
    for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
      if (this.ancestors.includes(ancestor)) continue;
      this.ancestors.push(ancestor);
      ancestor.on("visibleChanged", this.syncAnimation);
      ancestor.on("added", this.bindAncestors);
      ancestor.on("removed", this.bindAncestors);
    }
  }

  private canAnimate(): boolean {
    const source = this.sourceSprite;
    if (
      !source ||
      source.destroyed ||
      source.texture !== this.sourceTexture ||
      !this.inks.length ||
      !this.visible ||
      !this.renderable ||
      this.alpha <= 0 ||
      !source.visible ||
      source.alpha <= 0 ||
      !this.parent ||
      document.hidden ||
      this.reducedMotion.matches ||
      !animationsEnabled() ||
      !usePreferencesStore.getState().inGameAnimations
    )
      return false;
    for (const ancestor of this.ancestors) {
      if (!ancestor.visible || !ancestor.renderable || ancestor.alpha <= 0) return false;
    }
    let root = this.parent;
    while (root.parent) root = root.parent;
    let sourceRoot: Container = source;
    while (sourceRoot.parent) sourceRoot = sourceRoot.parent;
    return root === this.renderRoot && root === sourceRoot;
  }

  private readonly syncAnimation = (): void => {
    const active = this.canAnimate();
    const changed = this.surface.visible !== active;
    this.surface.visible = active;
    if (!active) {
      this.pulse?.pause();
      if (changed) this.requestRender();
      return;
    }
    this.syncTransform();
    if (this.pulse) {
      if (this.pulse.paused()) {
        this.pulse.resume();
        this.requestRender();
      }
      return;
    }
    this.pulse = gsap.to(this.breathing, {
      scale: CARD_LIVE_PULSE.maxScale,
      offsetY: -this.layers!.floatPx,
      duration: CARD_LIVE_PULSE.halfDurationS,
      ease: "sine.inOut",
      repeat: -1,
      yoyo: true,
      onUpdate: () => {
        if (!this.canAnimate()) {
          this.syncAnimation();
          return;
        }
        this.syncTransform();
        for (let index = 0; index < this.inks.length; index++) {
          const ink = this.inks[index]!;
          const region = this.layers!.regions[index]!;
          ink.scale.set(this.breathing.scale);
          ink.y = region.y + region.ink.height / 2 + this.breathing.offsetY;
        }
        this.requestRender();
      },
    });
    this.requestRender();
  };

  override destroy(_options?: DestroyOptions): void {
    this.onRender = null;
    this.off("added", this.bindAncestors);
    this.off("removed", this.bindAncestors);
    this.off("visibleChanged", this.syncAnimation);
    this.setSource(null);
    this.pulse?.kill();
    this.unsubscribePreferences();
    this.unsubscribeAnimations();
    this.reducedMotion.removeEventListener("change", this.syncAnimation);
    document.removeEventListener("visibilitychange", this.syncAnimation);
    super.destroy({ children: true });
  }
}
