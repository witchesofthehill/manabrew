import {
  CanvasTextMetrics,
  Container,
  ImageSource,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from "pixi.js";
import type { CardInteractionPanel } from "@/lib/cardRenderGeometry";
import { cardImageLoader } from "@/lib/cardRenderArtwork";

type PlaneswalkerRules = NonNullable<CardInteractionPanel["planeswalker"]>;

const loyaltyTextures = new Map<string, Promise<Texture>>();
let inkContext: CanvasRenderingContext2D | null = null;

function loyaltyTexture(url: string): Promise<Texture> {
  const cached = loyaltyTextures.get(url);
  if (cached) return cached;
  const loading = cardImageLoader([])([url], new AbortController().signal)
    .then((lease) => {
      const texture = new Texture({
        source: new ImageSource({ resource: lease.images.get(url)!, autoGarbageCollect: false }),
      });
      texture.once("destroy", () => {
        lease.dispose();
        loyaltyTextures.delete(url);
      });
      return texture;
    })
    .catch((error: unknown) => {
      loyaltyTextures.delete(url);
      throw error;
    });
  loyaltyTextures.set(url, loading);
  return loading;
}

function centerInk(
  text: Text,
  centerX: number,
  centerY: number,
  maxWidth?: number,
  widthScale = 1,
): void {
  inkContext ??= document.createElement("canvas").getContext("2d")!;
  const style = text.style;
  inkContext.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
  const ink = inkContext.measureText(text.text);
  const metrics = CanvasTextMetrics.measureText(text.text, style, undefined, false);
  const baseline =
    metrics.fontProperties.ascent +
    Math.max(0, (metrics.lineHeight - metrics.fontProperties.fontSize) / 2);
  text.pivot.set(
    (ink.actualBoundingBoxRight - ink.actualBoundingBoxLeft) / 2,
    baseline - (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2,
  );
  text.scale.x = maxWidth == null ? widthScale : Math.min(widthScale, maxWidth / ink.width);
  text.position.set(centerX, centerY);
}

export function addPlaneswalkerCost(
  row: Container,
  cost: string,
  height: number,
  geometry: PlaneswalkerRules,
  onChange: () => void,
): void {
  const { badge, colon } = geometry;
  const sign = cost.startsWith("+") ? "plus" : cost === "0" ? "zero" : "minus";
  const shield = new Sprite(Texture.EMPTY);
  shield.position.set(badge.x, (height - badge.height) / 2);
  shield.setSize(badge.width, badge.height);
  const value = new Text({
    text: cost,
    style: new TextStyle({
      fill: badge.ink,
      fontFamily: badge.fontFamily,
      fontSize: badge.fontSize,
      fontWeight: `${badge.fontWeight}`,
      lineHeight: badge.fontSize,
    }),
    resolution: 2,
  });
  centerInk(
    value,
    badge.x + badge.width / 2 + badge.numeralOffsetX,
    height / 2 + badge.numeralOffsetY[sign],
    badge.numeralMaxWidth,
    badge.numeralWidthScale,
  );
  value.visible = false;
  const punctuation = new Text({
    text: ":",
    style: new TextStyle({
      fill: colon.ink,
      fontFamily: colon.fontFamily,
      fontSize: colon.fontSize,
      lineHeight: colon.fontSize,
    }),
    resolution: 2,
  });
  centerInk(punctuation, colon.x, height / 2 + colon.offsetY);
  row.addChild(shield, value, punctuation);
  void loyaltyTexture(badge.assets[sign])
    .then((texture) => {
      if (row.destroyed || shield.destroyed) return;
      shield.texture = texture;
      shield.setSize(badge.width, badge.height);
      value.visible = true;
      onChange();
    })
    .catch(() => undefined);
}
