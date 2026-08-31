use serde_json::{Map, Value};

const LITERAL: &str = "$v";
const KEYED: &str = "$k";
const REMOVED: &str = "$d";
const ORDER: &str = "$o";

/// Stable key for an element of a keyed array. Cards carry `id`; zone entries
/// carry `zone` plus `ownerId` and no id of their own, so a plain merge patch
/// would replace the whole zone list whenever one card moved.
fn element_key(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    if let Some(id) = object.get("id").and_then(Value::as_str) {
        return Some(id.to_string());
    }
    match (
        object.get("zone").and_then(Value::as_str),
        object.get("ownerId").and_then(Value::as_str),
    ) {
        (Some(zone), Some(owner)) => Some(format!("{zone}/{owner}")),
        _ => None,
    }
}

fn keyed_elements(values: &[Value]) -> Option<Vec<(String, &Value)>> {
    let mut keys = Vec::with_capacity(values.len());
    for value in values {
        keys.push((element_key(value)?, value));
    }
    let mut seen: Vec<&str> = keys.iter().map(|(k, _)| k.as_str()).collect();
    seen.sort_unstable();
    let unique = seen.len();
    seen.dedup();
    (seen.len() == unique).then_some(keys)
}

fn find<'a>(entries: &'a [(String, &'a Value)], key: &str) -> Option<&'a Value> {
    entries.iter().find_map(|(k, v)| (k == key).then_some(*v))
}

/// Patch turning `previous` into `next`, or `None` when they are equal.
///
/// A patch that is not an object is a literal replacement, so `null` and arrays
/// survive without a delete sentinel colliding with real null fields.
pub fn diff(previous: &Value, next: &Value) -> Option<Value> {
    if previous == next {
        return None;
    }
    match (previous, next) {
        (Value::Object(before), Value::Object(after)) => {
            let mut patch = Map::new();
            for (key, value) in after {
                match before.get(key) {
                    Some(old) => {
                        if let Some(inner) = diff(old, value) {
                            patch.insert(key.clone(), inner);
                        }
                    }
                    None => {
                        patch.insert(key.clone(), literal(value));
                    }
                }
            }
            let removed: Vec<Value> = before
                .keys()
                .filter(|key| !after.contains_key(*key))
                .map(|key| Value::String(key.clone()))
                .collect();
            if !removed.is_empty() {
                patch.insert(REMOVED.to_string(), Value::Array(removed));
            }
            Some(Value::Object(patch))
        }
        (Value::Array(before), Value::Array(after)) => {
            match (keyed_elements(before), keyed_elements(after)) {
                (Some(before_keyed), Some(after_keyed)) => {
                    Some(keyed_diff(&before_keyed, &after_keyed))
                }
                _ => Some(literal(next)),
            }
        }
        _ => Some(literal(next)),
    }
}

fn keyed_diff(before: &[(String, &Value)], after: &[(String, &Value)]) -> Value {
    let mut changed = Map::new();
    for (key, value) in after {
        match find(before, key) {
            Some(old) => {
                if let Some(inner) = diff(old, value) {
                    changed.insert(key.clone(), inner);
                }
            }
            None => {
                changed.insert(key.clone(), literal(value));
            }
        }
    }
    let removed: Vec<Value> = before
        .iter()
        .filter(|(key, _)| find(after, key).is_none())
        .map(|(key, _)| Value::String(key.clone()))
        .collect();

    let mut patch = Map::new();
    if !changed.is_empty() {
        patch.insert(KEYED.to_string(), Value::Object(changed));
    }
    if !removed.is_empty() {
        patch.insert(REMOVED.to_string(), Value::Array(removed));
    }
    let before_order: Vec<&str> = before.iter().map(|(k, _)| k.as_str()).collect();
    let after_order: Vec<&str> = after.iter().map(|(k, _)| k.as_str()).collect();
    if before_order != after_order {
        patch.insert(
            ORDER.to_string(),
            Value::Array(
                after_order
                    .iter()
                    .map(|k| Value::String((*k).into()))
                    .collect(),
            ),
        );
    } else if patch.is_empty() {
        patch.insert(KEYED.to_string(), Value::Object(Map::new()));
    }
    Value::Object(patch)
}

/// Wrap a value that must replace rather than merge.
fn literal(value: &Value) -> Value {
    match value {
        Value::Object(_) => {
            let mut wrapper = Map::new();
            wrapper.insert(LITERAL.to_string(), value.clone());
            Value::Object(wrapper)
        }
        other => other.clone(),
    }
}

fn is_keyed_patch(patch: &Map<String, Value>) -> bool {
    patch.contains_key(KEYED) || patch.contains_key(ORDER)
}

/// Apply a patch produced by [`diff`].
pub fn apply(previous: &Value, patch: &Value) -> Value {
    let Value::Object(fields) = patch else {
        return patch.clone();
    };
    if let Some(value) = fields.get(LITERAL) {
        return value.clone();
    }
    if is_keyed_patch(fields) {
        return apply_keyed(previous, fields);
    }
    let mut result = previous.as_object().cloned().unwrap_or_default();
    if let Some(Value::Array(removed)) = fields.get(REMOVED) {
        for key in removed.iter().filter_map(Value::as_str) {
            result.remove(key);
        }
    }
    for (key, inner) in fields {
        if key == REMOVED {
            continue;
        }
        let base = result.get(key).cloned().unwrap_or(Value::Null);
        result.insert(key.clone(), apply(&base, inner));
    }
    Value::Object(result)
}

fn apply_keyed(previous: &Value, fields: &Map<String, Value>) -> Value {
    let empty = Vec::new();
    let before = previous.as_array().unwrap_or(&empty);
    let mut order: Vec<String> = Vec::with_capacity(before.len());
    let mut elements: Vec<(String, Value)> = Vec::with_capacity(before.len());
    for value in before {
        let key = element_key(value).unwrap_or_default();
        order.push(key.clone());
        elements.push((key, value.clone()));
    }
    if let Some(Value::Array(removed)) = fields.get(REMOVED) {
        for key in removed.iter().filter_map(Value::as_str) {
            elements.retain(|(k, _)| k != key);
            order.retain(|k| k != key);
        }
    }
    if let Some(Value::Object(changed)) = fields.get(KEYED) {
        for (key, inner) in changed {
            match elements.iter_mut().find(|(k, _)| k == key) {
                Some((_, value)) => *value = apply(value, inner),
                None => {
                    elements.push((key.clone(), apply(&Value::Null, inner)));
                    order.push(key.clone());
                }
            }
        }
    }
    if let Some(Value::Array(new_order)) = fields.get(ORDER) {
        order = new_order
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
    }
    let mut result = Vec::with_capacity(order.len());
    for key in &order {
        if let Some((_, value)) = elements.iter().find(|(k, _)| k == key) {
            result.push(value.clone());
        }
    }
    Value::Array(result)
}

/// Content fingerprint used to detect a client applying a patch to the wrong
/// base. FNV-1a over key-sorted JSON so the node and the client agree without
/// depending on map iteration order.
pub fn fingerprint(state: &Value) -> String {
    let mut canonical = String::new();
    write_canonical(state, &mut canonical);
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in canonical.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_unstable();
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String((*key).clone()).to_string());
                out.push(':');
                write_canonical(&map[*key], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn round_trip(before: Value, after: Value) {
        match diff(&before, &after) {
            Some(patch) => assert_eq!(apply(&before, &patch), after, "patch {patch}"),
            None => assert_eq!(before, after),
        }
    }

    #[test]
    fn null_fields_survive() {
        round_trip(
            json!({"power": 2, "toughness": null}),
            json!({"power": null, "toughness": 3}),
        );
    }

    #[test]
    fn removed_fields_are_explicit() {
        round_trip(json!({"a": 1, "b": 2}), json!({"a": 1}));
    }

    #[test]
    fn card_moving_zones_does_not_resend_the_battlefield() {
        let before = json!({"zones": [
            {"zone": "battlefield", "ownerId": "player-0", "count": 2, "cards": [
                {"id": "c1", "tapped": false, "text": "a long rules text"},
                {"id": "c2", "tapped": false, "text": "another long rules text"}]},
            {"zone": "graveyard", "ownerId": "player-0", "count": 0, "cards": []}]});
        let mut after = before.clone();
        after["zones"][0]["cards"][1]["tapped"] = json!(true);
        let patch = diff(&before, &after).expect("changed");
        assert_eq!(apply(&before, &patch), after);
        let encoded = patch.to_string();
        assert!(
            !encoded.contains("long rules text"),
            "resent card text: {encoded}"
        );
        assert!(encoded.len() < 120, "patch larger than expected: {encoded}");
    }

    #[test]
    fn reordering_is_carried() {
        let before = json!([{"id": "a"}, {"id": "b"}, {"id": "c"}]);
        let after = json!([{"id": "c"}, {"id": "a"}]);
        round_trip(before, after);
    }

    #[test]
    fn arrays_without_stable_keys_are_replaced() {
        round_trip(
            json!({"types": ["Land"]}),
            json!({"types": ["Creature", "Artifact"]}),
        );
    }

    #[test]
    fn object_replacing_a_scalar_is_literal() {
        round_trip(json!({"a": 1}), json!({"a": {"b": 2}}));
    }

    #[test]
    fn fingerprint_ignores_key_order() {
        assert_eq!(
            fingerprint(&json!({"a": 1, "b": {"c": 2, "d": 3}})),
            fingerprint(&json!({"b": {"d": 3, "c": 2}, "a": 1}))
        );
    }

    /// Round-trips every consecutive pair of a recorded production game.
    /// Point `STATE_DELTA_FIXTURE` at a JSON array of state sequences; the
    /// capture holds player data, so no fixture is checked in.
    #[test]
    fn recorded_states_round_trip() {
        let Ok(path) = std::env::var("STATE_DELTA_FIXTURE") else {
            return;
        };
        let raw = std::fs::read_to_string(path).expect("fixture");
        let sequences: Vec<Vec<Value>> = serde_json::from_str(&raw).expect("fixture json");
        let (mut full, mut delta, mut pairs) = (0usize, 0usize, 0usize);
        let mut worst = 0usize;
        for sequence in &sequences {
            for pair in sequence.windows(2) {
                let patch = diff(&pair[0], &pair[1]);
                let rebuilt = match &patch {
                    Some(patch) => apply(&pair[0], patch),
                    None => pair[0].clone(),
                };
                assert_eq!(rebuilt, pair[1], "delta did not reproduce the state");
                let size = patch.map_or(2, |p| p.to_string().len());
                full += pair[1].to_string().len();
                delta += size;
                worst = worst.max(size);
                pairs += 1;
            }
        }
        println!(
            "pairs {pairs}: full {:.1}MB, delta {:.1}MB, {:.0}x smaller, worst patch {worst}B",
            full as f64 / 1e6,
            delta as f64 / 1e6,
            full as f64 / delta.max(1) as f64
        );
    }

    /// The cases `src/lib/stateDelta.test.ts` runs against the TypeScript
    /// implementation. A browser host writes patches the relay and the other
    /// seats read, so both sides must emit the same bytes, not merely agree on
    /// the board. Absent when the crate is built outside the repo.
    #[test]
    fn shared_cases_match_the_typescript_implementation() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../src/lib/stateDelta.cases.json"
        );
        let Ok(raw) = std::fs::read_to_string(path) else {
            return;
        };
        let cases: Vec<Value> = serde_json::from_str(&raw).expect("cases json");
        assert!(!cases.is_empty());
        for case in &cases {
            let name = case["name"].as_str().unwrap_or_default();
            let (before, after, patch) = (&case["before"], &case["after"], &case["patch"]);
            assert_eq!(diff(before, after).as_ref(), Some(patch), "{name}: patch");
            assert_eq!(&apply(before, patch), after, "{name}: apply");
        }
    }

    #[test]
    fn fingerprint_separates_different_states() {
        assert_ne!(fingerprint(&json!({"a": 1})), fingerprint(&json!({"a": 2})));
    }
}
