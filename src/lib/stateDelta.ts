/**
 * Applies the state patches produced by `manabrew-agent-interface::state_delta`.
 * Keep the two in step: a patch that is not an object is a literal replacement,
 * which is what lets real `null` fields survive without a delete sentinel.
 */

const LITERAL = "$v";
const KEYED = "$k";
const REMOVED = "$d";
const ORDER = "$o";

type Json = unknown;
type JsonObject = Record<string, Json>;

function isObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cards carry `id`; zone entries carry `zone` plus `ownerId` and no id. */
function elementKey(value: Json): string | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value.id === "string") return value.id;
  if (typeof value.zone === "string" && typeof value.ownerId === "string") {
    return `${value.zone}/${value.ownerId}`;
  }
  return undefined;
}

function removedKeys(patch: JsonObject): string[] {
  const removed = patch[REMOVED];
  return Array.isArray(removed)
    ? removed.filter((key): key is string => typeof key === "string")
    : [];
}

export function applyStateDelta(previous: Json, patch: Json): Json {
  if (!isObject(patch)) return patch;
  if (LITERAL in patch) return patch[LITERAL];
  if (KEYED in patch || ORDER in patch) return applyKeyed(previous, patch);

  const result: JsonObject = isObject(previous) ? { ...previous } : {};
  for (const key of removedKeys(patch)) delete result[key];
  for (const [key, inner] of Object.entries(patch)) {
    if (key === REMOVED) continue;
    result[key] = applyStateDelta(result[key] ?? null, inner);
  }
  return result;
}

function applyKeyed(previous: Json, patch: JsonObject): Json {
  const before = Array.isArray(previous) ? previous : [];
  const elements = new Map<string, Json>();
  let order: string[] = [];
  for (const value of before) {
    const key = elementKey(value) ?? "";
    elements.set(key, value);
    order.push(key);
  }
  for (const key of removedKeys(patch)) {
    elements.delete(key);
    order = order.filter((existing) => existing !== key);
  }
  const changed = patch[KEYED];
  if (isObject(changed)) {
    for (const [key, inner] of Object.entries(changed)) {
      if (!elements.has(key)) order.push(key);
      elements.set(key, applyStateDelta(elements.get(key) ?? null, inner));
    }
  }
  const newOrder = patch[ORDER];
  if (Array.isArray(newOrder)) {
    order = newOrder.filter((key): key is string => typeof key === "string");
  }
  return order.filter((key) => elements.has(key)).map((key) => elements.get(key));
}
