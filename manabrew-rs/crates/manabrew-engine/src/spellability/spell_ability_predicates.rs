//! Predicate functions for filtering spell abilities.
//!
//! Mirrors Java's `SpellAbilityPredicates.java` — provides closure-based
//! predicates for filtering spell abilities by API type, sub-abilities, etc.

use crate::ability::api_type::ApiType;
use crate::spellability::SpellAbility;

/// Returns a predicate that matches spell abilities with the given API type.
/// Mirrors Java's `SpellAbilityPredicates.isApi(ApiType)`.
pub fn is_api(api: ApiType) -> impl Fn(&SpellAbility) -> bool {
    move |sa: &SpellAbility| sa.api == Some(api)
}

/// Returns a predicate that matches spell abilities whose sub-ability chain
/// contains an ability with the given API type.
/// Mirrors Java's `SpellAbilityPredicates.hasSubAbilityApi(ApiType)`.
pub fn has_sub_ability_api(api: ApiType) -> impl Fn(&SpellAbility) -> bool {
    move |sa: &SpellAbility| {
        let mut current = sa.sub_ability.as_deref();
        while let Some(sub) = current {
            if sub.api == Some(api) {
                return true;
            }
            current = sub.sub_ability.as_deref();
        }
        false
    }
}

/// Returns a predicate that checks if a spell ability matches all given
/// restriction strings. Each restriction is checked against the ability's params.
/// Mirrors Java's `SpellAbilityPredicates.isValid(String[])`.
pub fn is_valid<'a>(restrictions: &'a [&'a str]) -> impl Fn(&SpellAbility) -> bool + 'a {
    move |sa: &SpellAbility| {
        for &restriction in restrictions {
            // Check if the restriction matches a param key set to "True"
            if let Some(key) = restriction.strip_prefix('!') {
                // Negated restriction: must NOT have the param
                if sa.param_is_true(key) {
                    return false;
                }
            } else if restriction.contains('$') {
                // Key-value restriction: "Key$ Value" — check param equals value
                let parts: Vec<&str> = restriction.splitn(2, '$').collect();
                if parts.len() == 2 {
                    let key = parts[0].trim();
                    let expected = parts[1].trim();
                    match sa.param_value(key) {
                        Some(val) if val.eq_ignore_ascii_case(expected) => {}
                        _ => return false,
                    }
                }
            } else {
                // Simple flag restriction: param must be "True"
                if !sa.param_is_true(restriction) {
                    return false;
                }
            }
        }
        true
    }
}
