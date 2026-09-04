import { CanvasTextMetrics, Container, Sprite, Text, Texture, TextStyle } from "pixi.js";
import { getManaSymbolTextureSync, loadManaSymbolTexture } from "@/pixi/manaSymbolCache";

interface RichToken {
  kind: "text" | "symbol";
  value: string;
  width: number;
}

const TOKEN_PATTERN = /\{([^}]+)\}|\n|[^\s\n]+|[ \t]+/g;

export class PixiRichText extends Container {
  private generation = 0;

  setContent(
    content: string,
    style: TextStyle,
    width: number,
    symbolSize: number,
    lineGap = 4,
  ): number {
    const generation = ++this.generation;
    this.removeChildren().forEach((child) => child.destroy());
    if (!content) return 0;

    const rawTokens = content.match(TOKEN_PATTERN) ?? [];
    const lines: RichToken[][] = [[]];
    let lineWidth = 0;

    for (const raw of rawTokens) {
      if (raw === "\n") {
        lines.push([]);
        lineWidth = 0;
        continue;
      }

      const symbolMatch = /^\{([^}]+)\}$/.exec(raw);
      const token: RichToken = symbolMatch
        ? { kind: "symbol", value: symbolMatch[1]!, width: symbolSize }
        : {
            kind: "text",
            value: raw,
            width: CanvasTextMetrics.measureText(raw, style, undefined, false).width,
          };
      const isSpace = token.kind === "text" && /^\s+$/.test(token.value);
      const currentLine = lines[lines.length - 1]!;

      if (!isSpace && currentLine.length > 0 && lineWidth + token.width > width) {
        while (
          currentLine.length > 0 &&
          currentLine[currentLine.length - 1]!.kind === "text" &&
          /^\s+$/.test(currentLine[currentLine.length - 1]!.value)
        ) {
          currentLine.pop();
        }
        lines.push([token]);
        lineWidth = token.width;
        continue;
      }

      if (isSpace && currentLine.length === 0) continue;
      currentLine.push(token);
      lineWidth += token.width;
    }

    const fontSize = typeof style.fontSize === "number" ? style.fontSize : Number(style.fontSize);
    const lineHeight = Math.max(Number(style.lineHeight) || fontSize * 1.3, symbolSize);

    lines.forEach((line, lineIndex) => {
      let x = 0;
      let textRun = "";
      let textRunX = 0;
      const flushText = () => {
        if (!textRun) return;
        const text = new Text({ text: textRun, style });
        text.resolution = 2;
        text.position.set(textRunX, lineIndex * (lineHeight + lineGap));
        this.addChild(text);
        textRun = "";
      };

      for (const token of line) {
        if (token.kind === "text") {
          if (!textRun) textRunX = x;
          textRun += token.value;
          x += token.width;
          continue;
        }

        flushText();
        const sprite = new Sprite(getManaSymbolTextureSync(token.value) ?? Texture.EMPTY);
        sprite.position.set(x, lineIndex * (lineHeight + lineGap) + (lineHeight - symbolSize) / 2);
        sprite.setSize(symbolSize, symbolSize);
        this.addChild(sprite);
        if (sprite.texture === Texture.EMPTY) {
          void loadManaSymbolTexture(token.value)
            .then((texture) => {
              if (!this.destroyed && generation === this.generation && !sprite.destroyed) {
                sprite.texture = texture;
                sprite.setSize(symbolSize, symbolSize);
              }
            })
            .catch(() => undefined);
        }
        x += token.width;
      }
      flushText();
    });

    return lines.length * lineHeight + Math.max(0, lines.length - 1) * lineGap;
  }
}
