use crate::limited_player::PlayerFlags;

#[derive(Debug, Clone, Copy)]
pub struct ConspiracyHook {
    pub card_name: &'static str,
    pub flag: PlayerFlags,
    pub description: &'static str,
}

pub const CONSPIRACY_HOOKS: &[ConspiracyHook] = &[
    ConspiracyHook {
        card_name: "Agent of Acquisitions",
        flag: PlayerFlags::AGENT_ACQUISITIONS_CAN_DRAFT_ALL,
        description: "Once per draft, draft every card from a booster.",
    },
    ConspiracyHook {
        card_name: "Cogwork Librarian",
        flag: PlayerFlags::COGWORK_LIBRARIAN_EXTRA_DRAFT,
        description: "Draft an extra card; return Cogwork Librarian to the pack.",
    },
    ConspiracyHook {
        card_name: "Animus of Predation",
        flag: PlayerFlags::ANIMUS_REMOVE_FROM_POOL,
        description: "Remove a card you drafted from the draft.",
    },
    ConspiracyHook {
        card_name: "Noble Banneret",
        flag: PlayerFlags::NOBLE_BANNERET_ACTIVE,
        description: "Note Knight cards drafted; mana cost reductions in play.",
    },
    ConspiracyHook {
        card_name: "Paliano Vanguard",
        flag: PlayerFlags::PALIANO_VANGUARD_ACTIVE,
        description: "Note creature card colors drafted; pump triggers in play.",
    },
    ConspiracyHook {
        card_name: "Grinder",
        flag: PlayerFlags::GRINDER_REMOVE_FROM_POOL,
        description: "Remove a card you drafted from the draft.",
    },
    ConspiracyHook {
        card_name: "Whispergear Sneak",
        flag: PlayerFlags::WHISPERGEAR_BOOSTER_PEEK,
        description: "Look at an unopened booster.",
    },
    ConspiracyHook {
        card_name: "Illusionary Informant",
        flag: PlayerFlags::ILLUSIONARY_INFORMANT_PEEK,
        description: "Look at the cards a player has drafted.",
    },
    ConspiracyHook {
        card_name: "Leovold's Operative",
        flag: PlayerFlags::LEOVOLDS_OPERATIVE_CAN_EXTRA_DRAFT,
        description: "Draft an extra card; skip your next pick.",
    },
    ConspiracyHook {
        card_name: "Spy Network",
        flag: PlayerFlags::SPY_NEXT_CARD_DRAFTED,
        description: "Look at the next card the named player drafts.",
    },
    ConspiracyHook {
        card_name: "Canal Dredger",
        flag: PlayerFlags::CANAL_DREDGER_LAST_PICK,
        description: "Draft a card from the last booster of each round.",
    },
    ConspiracyHook {
        card_name: "Archdemon of Paliano",
        flag: PlayerFlags::ARCHDEMON_OF_PALIANO_CURSE,
        description: "Curse — must keep this in front of you.",
    },
    ConspiracyHook {
        card_name: "Smuggler Captain",
        flag: PlayerFlags::SMUGGLER_CAPTAIN_ACTIVE,
        description: "Reveal cards you drafted; opponents reveal too.",
    },
];

pub fn hook_for_card(name: &str) -> Option<&'static ConspiracyHook> {
    CONSPIRACY_HOOKS
        .iter()
        .find(|h| h.card_name.eq_ignore_ascii_case(name))
}

pub fn apply_pick_trigger(card_name: &str, flags: &mut PlayerFlags) -> bool {
    match hook_for_card(card_name) {
        Some(hook) => {
            flags.insert(hook.flag);
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_each_hook_card() {
        for hook in CONSPIRACY_HOOKS {
            assert!(hook_for_card(hook.card_name).is_some());
        }
    }

    #[test]
    fn case_insensitive_lookup() {
        assert!(hook_for_card("WHISPERGEAR SNEAK").is_some());
    }

    #[test]
    fn unknown_card_returns_none() {
        assert!(hook_for_card("Lightning Bolt").is_none());
    }
}
