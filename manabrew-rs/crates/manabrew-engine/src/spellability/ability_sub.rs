//! AbilitySub -- helper functions for sub-abilities in the chain.
//! Mirrors Java's `AbilitySub.java`.
//! Sub-abilities are chained via SpellAbility.sub_ability and resolve
//! sequentially after their parent.

use crate::spellability::SpellAbility;

/// Sub-abilities cannot be played independently -- they are always part of a
/// chain triggered by a parent spell or ability.
/// Mirrors Java's `AbilitySub.canPlay()` which returns false.
pub fn can_play() -> bool {
    false
}

/// Build a stack description for this sub-ability from its params.
/// Mirrors Java's `AbilitySub.getStackDescription()`.
///
/// Uses the `SpDesc` or `StackDescription` param if available, otherwise
/// falls back to the ability text.
pub fn resolve(sa: &SpellAbility) -> String {
    // Prefer explicit stack description
    if !sa.stack_description.is_empty() {
        return sa.stack_description.clone();
    }

    // Try SpDesc param
    if let Some(desc) = sa.ir.sp_desc_text.as_deref() {
        return desc.to_string();
    }

    // Try StackDescription param
    if let Some(desc) = sa.ir.stack_description_text.as_deref() {
        return desc.to_string();
    }

    // Fall back to the ability text
    if !sa.ability_text.is_empty() {
        return sa.ability_text.clone();
    }

    // Last resort: describe via API type
    match sa.api {
        Some(api) => format!("{:?} (sub-ability)", api),
        None => "Sub-ability".to_string(),
    }
}
