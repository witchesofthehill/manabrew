export interface PrototypeCharacteristics {
  manaCost: string;
  power: string;
  toughness: string;
}

export interface PrototypeRules {
  name: string;
  reminder: string;
  header: string;
  rulesText: string;
}

export function printedPrototype(rules: string): PrototypeCharacteristics | undefined {
  const match = /^Prototype\s+((?:\{[^}]+\})+)\s*[—–-]\s*([^/\s]+)\/([^\s(]+)/m.exec(rules);
  return match ? { manaCost: match[1]!, power: match[2]!, toughness: match[3]! } : undefined;
}

export function prototypeRules(
  rules: string,
  prototype: PrototypeCharacteristics,
): PrototypeRules | undefined {
  const lines = rules.split("\n");
  const comparable = (value: string) => value.normalize("NFKC").replace(/\s+/g, "");
  const marker = lines.findIndex((line) => /^\/\/PRT-[^/]+\/\/$/.test(line.trim()));
  if (marker >= 0) {
    const cost = lines[marker + 1]?.trim();
    const mechanic = lines[marker + 2]?.trim().match(/^([^()（）]+?)\s*([（(].*[)）])?$/u);
    const stats = lines[marker + 3]
      ?.normalize("NFKC")
      .trim()
      .match(/^([^/\s]+)\s*\/\s*(\S+)$/);
    if (
      !cost ||
      comparable(cost) !== comparable(prototype.manaCost) ||
      !mechanic ||
      !stats ||
      comparable(stats[1]!) !== comparable(prototype.power) ||
      comparable(stats[2]!) !== comparable(prototype.toughness) ||
      lines.some((line, index) => index !== marker && /\/\/PRT-/.test(line))
    ) {
      return undefined;
    }
    return {
      name: mechanic[1]!.trim(),
      reminder: mechanic[2] ?? "",
      header: `${mechanic[1]!.trim()} ${cost} — ${lines[marker + 3]!.trim()}${mechanic[2] ? ` ${mechanic[2]}` : ""}`,
      rulesText: [...lines.slice(0, marker), ...lines.slice(marker + 4)].join("\n"),
    };
  }
  if (/\/\/PRT-/.test(rules)) return undefined;
  const headers = lines.flatMap((line, index) => {
    const match = line
      .trim()
      .match(
        /^([^{}()（）]+?)\s*((?:\{[^{}]+\})+)\s*[—–-]\s*([^/／\s]+)[/／]([^\s(（]+)\s*([（(].*[)）])?$/u,
      );
    return match &&
      comparable(match[2]!) === comparable(prototype.manaCost) &&
      comparable(match[3]!) === comparable(prototype.power) &&
      comparable(match[4]!) === comparable(prototype.toughness)
      ? [{ index, name: match[1]!.trim(), reminder: match[5] ?? "" }]
      : [];
  });
  if (headers.length !== 1) return undefined;
  const header = headers[0]!;
  return {
    name: header.name,
    reminder: header.reminder,
    header: lines[header.index]!.trim(),
    rulesText: lines.filter((_, index) => index !== header.index).join("\n"),
  };
}
