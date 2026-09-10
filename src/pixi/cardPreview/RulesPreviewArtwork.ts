import { Container, FillGradient, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { hexToNum } from "@/pixi/colorUtils";
import { withAlpha } from "@/themes/gameTheme";

const ART_FADE_START = 0.85;
const ART_FADE_END_ALPHA = 0.8;
const ART_TOP_OVERLAP = 1;

export interface RulesPreviewArtworkLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  paper: string;
  fit: "contain" | "cover-top";
}

export class RulesPreviewArtwork {
  private artwork = new Sprite(Texture.EMPTY);
  private fade = new Graphics();
  private cornerCover = new Graphics();
  private sourceTexture = Texture.EMPTY;
  private croppedTexture: Texture | null = null;
  private cropKey = "";
  private fadeGradient: FillGradient | null = null;
  private fadeGradientColor = "";

  constructor(texture = Texture.EMPTY) {
    this.texture = texture;
  }

  get texture(): Texture {
    return this.sourceTexture;
  }

  set texture(texture: Texture) {
    if (this.sourceTexture === texture) return;
    this.releaseCroppedTexture();
    this.sourceTexture = texture;
    this.artwork.texture = texture;
  }

  get destroyed(): boolean {
    return this.artwork.destroyed;
  }

  addTo(parent: Container): void {
    parent.addChild(this.artwork, this.fade, this.cornerCover);
  }

  hide(): void {
    this.artwork.visible = false;
    this.fade.visible = false;
    this.cornerCover.visible = false;
  }

  layout(options: RulesPreviewArtworkLayout): void {
    const { x, y, width, height, radius, paper, fit } = options;
    const texture = this.sourceTexture;
    this.fade.clear();
    this.cornerCover.clear();
    if (
      texture === Texture.EMPTY ||
      texture.width <= 0 ||
      texture.height <= 0 ||
      width <= 0 ||
      height <= 0
    ) {
      this.hide();
      return;
    }

    this.artwork.visible = true;
    if (fit === "contain") {
      this.releaseCroppedTexture();
      const scale = Math.min(width / texture.width, height / texture.height);
      this.artwork.anchor.set(0.5);
      this.artwork.position.set(x + width / 2, y + height / 2);
      this.artwork.setSize(texture.width * scale, texture.height * scale);
      this.fade.visible = false;
      this.cornerCover.visible = false;
      return;
    }

    const artworkY = y - ART_TOP_OVERLAP;
    const artworkHeight = height + ART_TOP_OVERLAP;
    this.setCroppedTexture(width, artworkHeight);
    this.artwork.anchor.set(0);
    this.artwork.position.set(x, artworkY);
    this.artwork.setSize(width, artworkHeight);
    if (this.fadeGradient === null || this.fadeGradientColor !== paper) {
      this.fadeGradient?.destroy();
      this.fadeGradient = new FillGradient({
        type: "linear",
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        colorStops: [
          { offset: 0, color: withAlpha(paper, 0) },
          { offset: ART_FADE_START, color: withAlpha(paper, 0) },
          { offset: 1, color: withAlpha(paper, ART_FADE_END_ALPHA) },
        ],
      });
      this.fadeGradientColor = paper;
    }
    this.fade.visible = true;
    this.fade
      .roundRect(x, y, width, height, radius)
      .rect(x, y, width, radius)
      .fill(this.fadeGradient);
    this.cornerCover.visible = radius > 0;
    if (radius > 0) {
      const bottom = y + height;
      const cornerY = bottom - radius;
      this.cornerCover
        .moveTo(x, cornerY)
        .lineTo(x, bottom)
        .lineTo(x + radius, bottom)
        .arc(x + radius, cornerY, radius, Math.PI / 2, Math.PI)
        .closePath()
        .moveTo(x + width - radius, bottom)
        .lineTo(x + width, bottom)
        .lineTo(x + width, cornerY)
        .arc(x + width - radius, cornerY, radius, 0, Math.PI / 2)
        .closePath()
        .fill(hexToNum(paper));
    }
  }

  private setCroppedTexture(width: number, height: number): void {
    const texture = this.sourceTexture;
    const frame = texture.frame;
    const key = `${frame.x}:${frame.y}:${frame.width}:${frame.height}:${width}:${height}`;
    if (this.croppedTexture && this.cropKey === key) return;
    this.releaseCroppedTexture();
    const targetAspect = width / height;
    const sourceAspect = frame.width / frame.height;
    let cropX = frame.x;
    let cropWidth = frame.width;
    let cropHeight = frame.height;
    if (sourceAspect > targetAspect) {
      cropWidth = Math.max(1, Math.floor(frame.height * targetAspect));
      cropX += Math.floor((frame.width - cropWidth) / 2);
    } else {
      cropHeight = Math.max(1, Math.floor(frame.width / targetAspect));
    }
    this.croppedTexture = new Texture({
      source: texture.source,
      frame: new Rectangle(cropX, frame.y, cropWidth, cropHeight),
    });
    this.cropKey = key;
    this.artwork.texture = this.croppedTexture;
  }

  private releaseCroppedTexture(): void {
    if (!this.croppedTexture) return;
    this.artwork.texture = this.sourceTexture;
    this.croppedTexture.destroy(false);
    this.croppedTexture = null;
    this.cropKey = "";
  }

  destroy(): void {
    this.releaseCroppedTexture();
    this.fade.clear();
    this.fadeGradient?.destroy();
    this.fadeGradient = null;
    this.artwork.removeFromParent();
    this.fade.removeFromParent();
    this.cornerCover.removeFromParent();
    this.artwork.destroy();
    this.fade.destroy();
    this.cornerCover.destroy();
  }
}
