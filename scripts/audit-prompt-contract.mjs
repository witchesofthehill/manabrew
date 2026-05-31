import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function rustVariantToPromptType(variant) {
  return variant.charAt(0).toLowerCase() + variant.slice(1);
}

function extractRustPromptVariants() {
  const source = read("forge-engine/crates/forge-agent-interface/src/prompt.rs");
  const variants = [];
  let inEnum = false;
  for (const line of source.split("\n")) {
    if (line.includes("pub enum AgentPromptInner")) {
      inEnum = true;
      continue;
    }
    if (inEnum && line.startsWith("impl AgentPromptInner")) {
      break;
    }
    if (!inEnum) {
      continue;
    }
    const match = line.match(/^ {4}([A-Z][A-Za-z0-9]*)\s*\{/);
    if (match) {
      variants.push(match[1]);
    }
  }
  return variants;
}

function extractTsPromptTypes() {
  const source = read("src/types/promptType.ts");
  return [...source.matchAll(/^\s*([A-Za-z0-9_]+):\s*"([^"]+)"/gm)].map(
    ([, key, value]) => ({ key, value }),
  );
}

function extractPromptTypeReferences(relativePath) {
  const source = read(relativePath);
  return new Set(
    [...source.matchAll(/PromptType\.([A-Za-z0-9_]+)/g)].map(([, key]) => key),
  );
}

function extractJavaPromptKinds() {
  const source = read("forge-engine/crates/forge-agent-interface/src/java_raw.rs");
  const match = source.match(/fn kind_label\(&self\) -> &'static str \{[\s\S]*?\n {4}\}/);
  if (!match) {
    return [];
  }
  return [...match[0].matchAll(/"([a-z_]+)"/g)].map(([, kind]) => kind).sort();
}

function diff(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

const rustVariants = extractRustPromptVariants();
const rustPromptTypes = rustVariants.map(rustVariantToPromptType);
const tsPromptTypes = extractTsPromptTypes();
const tsKeys = tsPromptTypes.map((entry) => entry.key);
const tsValues = tsPromptTypes.map((entry) => entry.value);
const handledKeys = [...extractPromptTypeReferences("src/stores/gameStore.constants.ts")];
const actionViewKeys = [...extractPromptTypeReferences(
  "src/components/game/panels/PromptActionController.tsx",
)];
const nonActionPromptKeys = new Set(["StateUpdate", "GameOver"]);
const javaKinds = extractJavaPromptKinds();

const missingInTs = diff(rustPromptTypes, tsValues);
const extraInTs = diff(tsValues, rustPromptTypes);
const missingHandled = diff(tsKeys, handledKeys);
const missingActionView = diff(
  tsKeys.filter((key) => !nonActionPromptKeys.has(key)),
  actionViewKeys,
);

console.log("Prompt contract audit");
console.log("=====================");
console.log(`Rust AgentPromptInner variants: ${rustPromptTypes.length}`);
console.log(`TypeScript PromptType values: ${tsValues.length}`);
console.log(`UI handled PromptType entries: ${handledKeys.length}`);
console.log(`Prompt action view mappings: ${actionViewKeys.length}`);
console.log(`Java normalizer raw prompt kinds: ${javaKinds.join(", ") || "none"}`);
console.log("");

function printList(title, values) {
  console.log(`${title}: ${values.length === 0 ? "none" : ""}`);
  for (const value of values) {
    console.log(`- ${value}`);
  }
  console.log("");
}

printList("Rust prompt types missing from TypeScript", missingInTs);
printList("TypeScript prompt types missing from Rust", extraInTs);
printList("TypeScript PromptType keys missing from HANDLED_PROMPT_TYPES", missingHandled);
printList("TypeScript PromptType keys without prompt action view mapping", missingActionView);

if (
  missingInTs.length > 0 ||
  extraInTs.length > 0 ||
  missingHandled.length > 0 ||
  missingActionView.length > 0
) {
  process.exitCode = 1;
}
