export interface PrototypeCharacteristics {
  manaCost: string;
  power: string;
  toughness: string;
}

export function printedPrototype(rules: string): PrototypeCharacteristics | undefined {
  const match = /^Prototype\s+((?:\{[^}]+\})+)\s*[—–-]\s*([^/\s]+)\/([^\s(]+)/m.exec(rules);
  return match ? { manaCost: match[1]!, power: match[2]!, toughness: match[3]! } : undefined;
}
