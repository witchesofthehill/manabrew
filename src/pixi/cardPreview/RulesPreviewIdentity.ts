import { Container, Sprite, Text, TextStyle, Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { ScryfallCard } from "@/types/scryfall";
import type { RulesPreviewSection } from "./rulesCardPreviewPresentation";
import { PixiRichText } from "./PixiRichText";
import { setSymbolTexture } from "./setSymbolCache";
import { effectiveRarity, rarityToken } from "@/lib/cardRarity";
import { hexToNum } from "@/pixi/colorUtils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { RULES_TITLE_FONT, type RulesPreviewFrameStyle } from "./rulesPreviewFrame";

const SET_SYMBOL_SIZE = 22;

interface RulesPreviewIdentityOptions {
  section: Pick<RulesPreviewSection, "name" | "manaCost" | "typeLine">;
  width: number;
  headerHeight: number;
  typeY: number;
  contentPad: number;
  fontFamily: string;
  fontSize: number;
  info: ScryfallCard | null;
  setCode: string;
  faceless: boolean;
  theme: Theme;
  frame: RulesPreviewFrameStyle;
}

export class RulesPreviewIdentity extends Container {
  readonly typeHeight: number;

  constructor(options: RulesPreviewIdentityOptions) {
    super();
    const { section, width, headerHeight, typeY, contentPad, fontFamily, fontSize, frame } =
      options;
    const foreground = frame.ink;
    const mana = new PixiRichText();
    const manaWidth = Math.min(108, (width - contentPad * 2) * 0.4);
    mana.setContent(
      section.manaCost,
      new TextStyle({
        fill: foreground,
        fontFamily: RULES_TITLE_FONT,
        fontSize: 15,
        fontWeight: "600",
      }),
      manaWidth,
      18,
      1,
    );
    if (mana.height > headerHeight - 20) mana.scale.set((headerHeight - 20) / mana.height);
    mana.position.set(width - contentPad - mana.width, 10 + (headerHeight - 20 - mana.height) / 2);
    this.addChild(mana);
    const name = new Text({
      text: section.name,
      style: new TextStyle({
        fill: foreground,
        fontFamily,
        fontSize,
        fontWeight: "700",
        lineHeight: fontSize * 1.15,
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: Math.max(1, mana.x - contentPad - 8),
      }),
    });
    name.resolution = 2;
    const nameScale = Math.min(
      1,
      (headerHeight - 20) / name.height,
      (mana.x - contentPad - 8) / name.width,
    );
    name.scale.set(nameScale);
    name.position.set(contentPad, 10 + (headerHeight - 20 - name.height) / 2);
    this.addChild(name);
    const type = new Text({
      text: section.typeLine,
      style: new TextStyle({
        fill: frame.mutedInk,
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 13,
        fontWeight: "500",
        lineHeight: 17,
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: Math.max(
          1,
          width - contentPad * 2 - (options.faceless ? 0 : SET_SYMBOL_SIZE + 10),
        ),
      }),
    });
    type.resolution = 2;
    if (type.height > 34) type.scale.set(34 / type.height);
    type.position.set(contentPad, typeY + 6);
    this.typeHeight = Math.max(30, type.height + 12);
    this.addChild(type);
    if (!options.faceless) this.addSetSymbol(options);
  }

  private addSetSymbol({
    width,
    contentPad,
    typeY,
    info,
    setCode,
    theme,
    frame,
  }: RulesPreviewIdentityOptions): void {
    const symbol = new Sprite(Texture.EMPTY);
    const fallback = new Text({
      text: setCode.toUpperCase(),
      style: new TextStyle({
        fill: frame.mutedInk,
        fontFamily: RULES_TITLE_FONT,
        fontSize: 9,
        fontWeight: "700",
      }),
    });
    const right = width - contentPad;
    fallback.resolution = 2;
    fallback.anchor.set(0.5);
    fallback.position.set(right - SET_SYMBOL_SIZE / 2, typeY + this.typeHeight / 2);
    symbol.position.set(right - SET_SYMBOL_SIZE, typeY + (this.typeHeight - SET_SYMBOL_SIZE) / 2);
    symbol.visible = false;
    this.addChild(fallback, symbol);
    if (!info) return;
    const rarity = effectiveRarity(info);
    const token = rarityToken(rarity);
    if (!token) return;
    const color = rarity === "common" ? frame.ink : theme.gameTheme.rarity[token];
    fallback.text = rarity[0]!.toUpperCase();
    fallback.style.fill = color;
    const url = useScryfallStore
      .getState()
      .sets.find((set) => set.code === info.set.toLowerCase())?.icon_svg_uri;
    if (!url) return;
    void setSymbolTexture(url)
      .then((texture) => {
        if (symbol.destroyed) return;
        symbol.texture = texture;
        symbol.tint = hexToNum(color);
        symbol.setSize(SET_SYMBOL_SIZE, SET_SYMBOL_SIZE);
        symbol.visible = true;
        fallback.visible = false;
      })
      .catch(() => undefined);
  }
}
