import { engineManaToMse, engineRulesToMse } from "./lib/mse/engine-card.mjs";

const textboxCounts = ["one", "two", "three", "four", "five", "six", "seven"];

export function classFields(rules) {
  const sections = [{ text: [], cost: "" }];
  for (const line of rules.split("\n")) {
    const level = /^(.*):\s*Level\s+(\d+)\s*$/i.exec(line);
    if (
      level &&
      Number(level[2]) === sections.length + 1 &&
      sections.length < textboxCounts.length
    ) {
      sections.push({ text: [], cost: level[1] });
    } else {
      sections.at(-1).text.push(line);
    }
  }
  const nativeCard = {};
  sections.forEach((section, index) => {
    nativeCard[`level_${index + 1}_text`] = engineRulesToMse(section.text.join("\n"));
    if (index > 0) nativeCard[`level_${index + 8}_text`] = engineRulesToMse(section.cost);
  });
  return {
    nativeCard,
    styling: {
      textboxes: textboxCounts[sections.length - 1],
      first_divider: "level",
      second_divider: "level",
      following_dividers: "level",
    },
  };
}

export function levelerFields(rules) {
  const sections = [{ text: [], level: "", power: null, toughness: null }];
  for (const line of rules.split("\n")) {
    const level = /^LEVEL\s+(\d+(?:\s*[-–]\s*\d+|\+))\s*$/i.exec(line);
    if (level) {
      if (sections.length === 3) return null;
      sections.push({ text: [], level: level[1], power: null, toughness: null });
      continue;
    }
    const section = sections.at(-1);
    const stats =
      sections.length > 1 && section.text.length === 0
        ? /^([*\d+−-]+)\/([*\d+−-]+)$/.exec(line.trim())
        : null;
    if (stats && section.power === null) {
      section.power = stats[1];
      section.toughness = stats[2];
    } else {
      section.text.push(line);
    }
  }
  if (sections.length !== 3) return null;
  const nativeCard = { rule_text: engineRulesToMse(sections[0].text.join("\n")) };
  sections.slice(1).forEach((section, index) => {
    nativeCard[`level_${index + 1}`] = section.level;
    nativeCard[`level_${index + 2}_text`] = engineRulesToMse(section.text.join("\n"));
    if (section.power !== null) nativeCard[`power_${index + 2}`] = section.power;
    if (section.toughness !== null) nativeCard[`toughness_${index + 2}`] = section.toughness;
  });
  return { nativeCard, styling: {} };
}

export function prototypeFields(rules) {
  const lines = rules.split("\n");
  const index = lines.findIndex((line) => /^Prototype\s/.test(line));
  if (index < 0) return null;
  const prototype = /^Prototype\s+((?:\{[^}]+\})+)\s+[—–-]\s+([*\d+−-]+)\/([*\d+−-]+)(.*)$/.exec(
    lines[index],
  );
  if (!prototype) return null;
  lines.splice(index, 1);
  return {
    nativeCard: {
      casting_cost_2: engineManaToMse(prototype[1]),
      power_2: prototype[2],
      toughness_2: prototype[3],
      level_1_text: engineRulesToMse(`Prototype${prototype[4]}`),
      rule_text: engineRulesToMse(lines.join("\n")),
    },
    styling: { frames: "prototype", prototype_secondary: "pt" },
  };
}

export function mutateFields(rules) {
  const lines = rules.split("\n");
  const index = lines.findIndex((line) => /^Mutate\s+(?:\{[^}]+\})+/.test(line));
  if (index < 0) return null;
  const [mutate] = lines.splice(index, 1);
  return {
    nativeCard: {
      level_1_text: engineRulesToMse(mutate),
      rule_text: engineRulesToMse(lines.join("\n")),
    },
    styling: { frames: "mutate" },
  };
}

export function planarFields(rules, type) {
  const lines = rules.split("\n");
  const phenomenon = /\bPhenomenon\b/.test(type);
  const chaos = phenomenon
    ? -1
    : lines.findIndex((line) => /^Whenever (?:chaos ensues\b|you roll \{CHAOS\})/.test(line));
  const sections = chaos > 0 ? [lines.slice(0, chaos), lines.slice(chaos)] : [lines];
  const nativeCard = {};
  sections.forEach((section, index) => {
    const text = engineRulesToMse(section.join("\n"));
    nativeCard[`level_${index + 1}_text`] =
      chaos >= 0 && index === sections.length - 1
        ? `<margin:900:0:0>${text}</margin:900:0:0>`
        : text;
  });
  return {
    nativeCard,
    styling: {
      number_of_textboxes: String(sections.length),
      chaos_symbol: chaos >= 0 ? "yes" : "no",
      phenomenon: phenomenon ? "yes" : "no",
    },
  };
}
