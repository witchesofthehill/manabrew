import { Container, Sprite, Text, TextStyle, Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { ScryfallCard } from "@/types/scryfall";
import type { RulesPreviewSection } from "./rulesCardPreviewPresentation";
import { PixiRichText } from "./PixiRichText";
import { setSymbolTexture } from "./setSymbolCache";
import { effectiveRarity, rarityToken } from "@/lib/cardRarity";
import { hexToNum } from "@/pixi/colorUtils";
import { useScryfallStore } from "@/stores/useScryfallStore";

const UI_FONT = "Inter, system-ui, sans-serif";

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
}

export class RulesPreviewIdentity extends Container {
  readonly typeHeight: number;

  constructor(options: RulesPreviewIdentityOptions) {
    super();
    const { section, width, headerHeight, typeY, contentPad, fontFamily, fontSize, theme } =
      options;
    const foreground = theme.appTheme["popover-foreground"];
    const mana = new PixiRichText();
    mana.setContent(
      section.manaCost,
      new TextStyle({ fill: foreground, fontFamily: UI_FONT, fontSize: 16, fontWeight: "600" }),
      108,
      19,
      1,
    );
    mana.position.set(width - contentPad - mana.width, 13);
    this.addChild(mana);
    const name = new Text({
      text: section.name,
      style: new TextStyle({
        fill: foreground,
        fontFamily,
        fontSize,
        fontWeight: "700",
        lineHeight: 24,
        wordWrap: true,
        wordWrapWidth: Math.max(60, mana.x - contentPad - 8),
      }),
    });
    name.resolution = 2;
    name.position.set(contentPad, 8);
    if (name.height > headerHeight - 16) name.scale.set((headerHeight - 16) / name.height);
    this.addChild(name);
    const type = new Text({
      text: section.typeLine,
      style: new TextStyle({
        fill: foreground,
        fontFamily,
        fontSize: 14,
        fontWeight: "700",
        lineHeight: 16,
        wordWrap: true,
        wordWrapWidth: width - contentPad * 2 - 34,
      }),
    });
    type.resolution = 2;
    type.position.set(contentPad, typeY + 7);
    this.typeHeight = type.height + 14;
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
  }: RulesPreviewIdentityOptions): void {
    const symbol = new Sprite(Texture.EMPTY);
    const fallback = new Text({
      text: setCode.toUpperCase(),
      style: new TextStyle({
        fill: theme.appTheme["muted-foreground"],
        fontFamily: UI_FONT,
        fontSize: 9,
        fontWeight: "700",
      }),
    });
    const right = width - contentPad;
    fallback.resolution = 2;
    fallback.anchor.set(0.5);
    fallback.position.set(right - 11, typeY + 16);
    symbol.position.set(right - 22, typeY + 5);
    symbol.visible = false;
    this.addChild(fallback, symbol);
    if (!info) return;
    const rarity = effectiveRarity(info);
    const token = rarityToken(rarity);
    if (!token) return;
    const color = theme.gameTheme.rarity[token];
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
        symbol.setSize(22, 22);
        symbol.visible = true;
        fallback.visible = false;
      })
      .catch(() => undefined);
  }
}
