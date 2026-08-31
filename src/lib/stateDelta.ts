/**
 * Produces and applies the state patches shared with
 * `manabrew-relay-protocol::state_delta`. Keep the implementations in step: a
 * patch that is not an object is a literal replacement, which is what lets real
 * `null` fields survive without a delete sentinel.
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

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
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

function jsonEquals(left: Json, right: Json): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => jsonEquals(value, right[index]))
    );
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => hasOwn(right, key) && jsonEquals(left[key], right[key]))
  );
}

function keyedElements(values: Json[]): Map<string, Json> | undefined {
  const elements = new Map<string, Json>();
  for (const value of values) {
    const key = elementKey(value);
    if (key === undefined || elements.has(key)) return undefined;
    elements.set(key, value);
  }
  return elements;
}

function literal(value: Json): Json {
  return isObject(value) ? { [LITERAL]: value } : value;
}

export function diffStateDelta(previous: Json, next: Json): Json | undefined {
  if (jsonEquals(previous, next)) return undefined;

  if (isObject(previous) && isObject(next)) {
    const patch: JsonObject = {};
    for (const [key, value] of Object.entries(next)) {
      const inner = hasOwn(previous, key) ? diffStateDelta(previous[key], value) : literal(value);
      if (inner !== undefined) patch[key] = inner;
    }
    const removed = Object.keys(previous).filter((key) => !hasOwn(next, key));
    if (removed.length > 0) patch[REMOVED] = removed;
    return patch;
  }

  if (Array.isArray(previous) && Array.isArray(next)) {
    const before = keyedElements(previous);
    const after = keyedElements(next);
    if (!before || !after) return literal(next);

    const changed: JsonObject = {};
    for (const [key, value] of after) {
      const inner = before.has(key) ? diffStateDelta(before.get(key), value) : literal(value);
      if (inner !== undefined) changed[key] = inner;
    }
    const removed = [...before.keys()].filter((key) => !after.has(key));
    const beforeOrder = [...before.keys()];
    const afterOrder = [...after.keys()];
    const patch: JsonObject = {};
    if (Object.keys(changed).length > 0) patch[KEYED] = changed;
    if (removed.length > 0) patch[REMOVED] = removed;
    if (!jsonEquals(beforeOrder, afterOrder)) patch[ORDER] = afterOrder;
    // An array patch must never be a bare object: the applier would read one as
    // a merge onto an object and hand back the wrong shape.
    if (Object.keys(patch).length === 0) patch[KEYED] = {};
    return patch;
  }

  return literal(next);
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
