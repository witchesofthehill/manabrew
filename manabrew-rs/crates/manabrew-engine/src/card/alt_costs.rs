//! Alternative cost getters for Card.
//!
//! These methods extract cost information from keywords following the "Keyword:cost" pattern.
//! They're used by the casting/playability system to present alternative casting options.

use super::Card;

impl Card {
    // ── Keyword cost helpers (pattern: "Keyword:cost_string") ────────

    /// Get buyback cost (e.g. "Buyback:2" → Some("2")).
    pub fn get_buyback_cost(&self) -> Option<String> {
        self.get_keyword_cost("Buyback")
    }

    /// Get spectacle cost (e.g. "Spectacle:B R" → Some("B R")).
    pub fn get_spectacle_cost(&self) -> Option<String> {
        self.get_keyword_cost("Spectacle")
    }

    /// Get evoke cost (e.g. "Evoke:2 B" → Some("2 B")).
    pub fn get_evoke_cost(&self) -> Option<String> {
        self.get_keyword_cost("Evoke")
    }

    /// Get every Evoke cost on this card (intrinsic + granted). Multiple Evoke
    /// keywords stack independently — e.g. an Elemental in hand under Ashling,
    /// the Limitless has both its native `Evoke:2 U` and the granted `Evoke:4`.
    /// Each is a distinct alternative cost in MTG and a separate playable entry.
    pub fn get_all_evoke_costs(&self) -> Vec<String> {
        let prefix = "Evoke:";
        let mut out = Vec::new();
        for kw in self.keywords.iter_strings() {
            if let Some(cost) = kw.strip_prefix(prefix) {
                out.push(cost.to_string());
            }
        }
        for kw in self.granted_keywords.iter_strings() {
            if let Some(cost) = kw.strip_prefix(prefix) {
                out.push(cost.to_string());
            }
        }
        out
    }

    /// Get bestow cost (e.g. "Bestow:3 G G" → Some("3 G G")).
    pub fn get_bestow_cost(&self) -> Option<String> {
        self.get_keyword_cost("Bestow")
    }

    /// Get dash cost (e.g. "Dash:1 R" → Some("1 R")).
    pub fn get_dash_cost(&self) -> Option<String> {
        self.get_keyword_cost("Dash")
    }

    /// Get blitz cost (e.g. "Blitz:1 R" → Some("1 R")).
    pub fn get_blitz_cost(&self) -> Option<String> {
        self.get_keyword_cost("Blitz")
    }

    /// Get warp cost (e.g. "Warp:1 B" → Some("1 B")).
    pub fn get_warp_cost(&self) -> Option<String> {
        self.get_keyword_cost("Warp")
    }

    /// Get multikicker cost (e.g. "Multikicker:1 G" → Some("1 G")).
    pub fn get_multikicker_cost(&self) -> Option<String> {
        self.get_keyword_cost("Multikicker")
    }

    /// Get replicate cost (e.g. "Replicate:U" → Some("U")).
    pub fn get_replicate_cost(&self) -> Option<String> {
        self.get_keyword_cost("Replicate")
    }

    /// Get entwine cost (e.g. "Entwine:2" → Some("2")).
    pub fn get_entwine_cost(&self) -> Option<String> {
        self.get_keyword_cost("Entwine")
    }

    /// Get escalate cost (e.g. "Escalate:1" → Some("1")).
    pub fn get_escalate_cost(&self) -> Option<String> {
        self.get_keyword_cost("Escalate")
    }

    /// Get escape cost and exile count (e.g. "Escape:1 B B:4" → Some(("1 B B", 4))).
    /// Delegates parsing to the keyword module.
    pub fn get_escape_cost(&self) -> Option<(String, i32)> {
        crate::keyword::extract_escape(&self.keywords)
            .or_else(|| crate::keyword::extract_escape(&self.granted_keywords))
            .map(|info| (info.mana_cost, info.exile_count))
    }

    /// Get overload cost (e.g. "Overload:3 R" → Some("3 R")).
    pub fn get_overload_cost(&self) -> Option<String> {
        self.get_keyword_cost("Overload")
    }

    /// Get madness cost (e.g. "Madness:1 R" → Some("1 R")).
    pub fn get_madness_cost(&self) -> Option<String> {
        self.get_keyword_cost("Madness")
    }

    /// Get strive cost (e.g. "Strive:1 W" → Some("1 W")).
    pub fn get_strive_cost(&self) -> Option<String> {
        self.get_keyword_cost("Strive")
    }

    /// Get suspend cost and time counters (e.g. "Suspend:1 U:3" → Some(("1 U", 3))).
    /// Delegates parsing to the keyword module.
    pub fn get_suspend_cost(&self) -> Option<(String, i32)> {
        crate::keyword::extract_suspend(&self.keywords)
            .or_else(|| crate::keyword::extract_suspend(&self.granted_keywords))
            .map(|info| (info.mana_cost, info.time_counters))
    }

    /// Get foretell cost (e.g. "Foretell:W W" → Some("W W")).
    pub fn get_foretell_cost(&self) -> Option<String> {
        self.get_keyword_cost("Foretell")
    }

    /// Get emerge cost (e.g. "Emerge:5 U U" → Some("5 U U")).
    pub fn get_emerge_cost(&self) -> Option<String> {
        self.get_keyword_cost("Emerge")
    }

    /// Get offering type (e.g. "Offering:Snake" → Some("Snake")).
    pub fn get_offering_type(&self) -> Option<String> {
        self.get_keyword_cost("Offering")
    }

    /// Generic keyword cost parser — delegates to the keyword module.
    /// Looks for "Keyword:cost" in intrinsic and granted keywords.
    pub fn get_keyword_cost(&self, keyword: &str) -> Option<String> {
        crate::keyword::extract_keyword_cost_from_all(
            [&self.keywords, &self.granted_keywords],
            keyword,
        )
    }

    /// Get a keyword's numeric amount (e.g. "Dredge:2" → Some(2)).
    pub fn get_keyword_amount(&self, keyword: &str) -> Option<usize> {
        self.get_keyword_cost(keyword)
            .and_then(|s| s.trim().parse::<usize>().ok())
    }

    /// Get Ward cost (e.g. "Ward:2" → Some("2"), "Ward:{U}" → Some("{U}")).
    pub fn get_ward_cost(&self) -> Option<String> {
        self.get_keyword_cost("Ward")
    }

    pub fn get_flashback_cost(&self) -> Option<String> {
        if let Some(cost) = self.get_keyword_cost("Flashback") {
            return Some(cost);
        }
        if self.has_keyword("Flashback") && !self.mana_cost.is_no_cost() {
            return Some(mana_cost_script_string(&self.mana_cost));
        }
        None
    }

    /// Get Harmonize cost (e.g. "Harmonize:X G G" → Some("X G G")).
    pub fn get_harmonize_cost(&self) -> Option<String> {
        self.get_keyword_cost("Harmonize")
    }

    /// Get Kicker cost (e.g. "Kicker:W" → Some("W")).
    pub fn get_kicker_cost(&self) -> Option<String> {
        self.get_keyword_cost("Kicker")
    }
}

fn mana_cost_script_string(mc: &forge_foundation::ManaCost) -> String {
    let mut tokens: Vec<String> = Vec::new();
    for shard in mc.shards() {
        if *shard == forge_foundation::ManaCostShard::X {
            tokens.push("X".to_string());
        }
    }
    if mc.generic_cost() > 0 {
        tokens.push(mc.generic_cost().to_string());
    }
    for shard in mc.shards() {
        if *shard != forge_foundation::ManaCostShard::X {
            tokens.push(shard.short_string().to_string());
        }
    }
    tokens.join(" ")
}
