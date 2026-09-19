//! Training reads the feature indices this file emits (`WasmManabot::features`),
//! so the featurizer is the contract between `manabot-train` and the bot.

use std::collections::BTreeSet;

use manabrew_protocol::prompts::common::{AvailableAction, AvailableActionKind};
use serde::Deserialize;

use super::SimpleAi;
use manabrew_agent_interface::game_view_dto::{CardDto, ZoneKind};

pub const DIM: usize = 1 << 18;

pub struct LinearModel {
    weights: Vec<f32>,
}

#[derive(Deserialize)]
struct ModelFile {
    dim: usize,
    weights: Vec<(u32, f32)>,
}

impl LinearModel {
    pub fn from_json(json: &str) -> Result<Self, String> {
        let file: ModelFile = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if file.dim != DIM {
            return Err(format!("model dim {} != featurizer dim {DIM}", file.dim));
        }
        let mut weights = vec![0.0; DIM];
        for (index, weight) in file.weights {
            weights[index as usize & (DIM - 1)] = weight;
        }
        Ok(Self { weights })
    }

    pub fn score(&self, features: &[u32]) -> f32 {
        features
            .iter()
            .map(|&index| self.weights[index as usize & (DIM - 1)])
            .sum()
    }
}

fn fnv1a(text: &str) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in text.bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

fn bucket(value: i32, edges: &[i32]) -> usize {
    edges.iter().filter(|&&edge| value >= edge).count()
}

const STOPWORDS: &[&str] = &[
    "the", "and", "you", "your", "that", "this", "for", "with", "from", "its", "are", "may",
    "then", "until", "any", "all", "each", "one", "two", "three", "into", "onto", "not",
];

fn text_tokens(text: &str) -> BTreeSet<String> {
    text.to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|word| word.len() >= 3 && !STOPWORDS.contains(word))
        .take(60)
        .map(str::to_string)
        .collect()
}

pub struct PromptContext {
    plain: Vec<String>,
    step: String,
    own_turn: bool,
    stack_foreign: bool,
    untapped_mana: i32,
    lands: i32,
    best_opp_creature: usize,
}

#[derive(Default)]
struct Feats {
    plain: Vec<String>,
    conj: Vec<String>,
}

impl Feats {
    fn plain(&mut self, f: impl Into<String>) {
        self.plain.push(f.into());
    }
    fn conj(&mut self, f: impl Into<String>) {
        self.conj.push(f.into());
    }
}

impl SimpleAi {
    pub(crate) fn prompt_context(&self, player_id: &str, candidates: usize) -> PromptContext {
        let view = self.view.as_ref();
        let step = view.map_or("none".to_string(), |v| format!("{:?}", v.step));
        let own_turn = view.is_some_and(|v| v.active_player_id == player_id);
        let stack_foreign =
            view.is_some_and(|v| v.stack.iter().any(|s| s.controller_id != player_id));
        let stack_own = view.is_some_and(|v| v.stack.iter().any(|s| s.controller_id == player_id));
        let turn = view.map_or(0, |v| v.turn as i32);
        let lands = self.lands_in_play(player_id) as i32;
        let untapped_mana = self.available_mana(player_id);
        let my_creatures = self
            .battlefield(player_id)
            .filter(|c| c.types.iter().any(|t| t == "Creature"))
            .count() as i32;
        let opponents: Vec<&str> = view
            .map(|v| {
                v.players
                    .iter()
                    .filter(|p| p.id != player_id)
                    .map(|p| p.id.as_str())
                    .collect()
            })
            .unwrap_or_default();
        let opp_creatures = opponents
            .iter()
            .map(|opp| {
                self.battlefield(opp)
                    .filter(|c| c.types.iter().any(|t| t == "Creature"))
                    .count() as i32
            })
            .sum::<i32>();
        let best_opp_creature_value = opponents
            .iter()
            .flat_map(|opp| self.battlefield(opp))
            .filter(|c| c.types.iter().any(|t| t == "Creature"))
            .map(Self::card_value)
            .max()
            .unwrap_or(0);
        let my_life = view
            .and_then(|v| v.players.iter().find(|p| p.id == player_id))
            .map_or(0, |p| p.life);
        let min_opp_life = view
            .map(|v| {
                v.players
                    .iter()
                    .filter(|p| p.id != player_id && p.life > 0)
                    .map(|p| p.life)
                    .min()
                    .unwrap_or(0)
            })
            .unwrap_or(0);
        let hand = view
            .map(|v| {
                v.zones
                    .iter()
                    .filter(|z| z.zone == ZoneKind::Hand && z.owner_id == player_id)
                    .map(|z| z.count as i32)
                    .sum::<i32>()
            })
            .unwrap_or(0);
        let best_opp_creature = bucket(best_opp_creature_value, &[1, 10, 20, 30, 45]);

        let plain = vec![
            format!("c:step={step}"),
            format!("c:own={own_turn}"),
            format!("c:stackF={stack_foreign}"),
            format!("c:stackO={stack_own}"),
            format!("c:turn={}", bucket(turn, &[2, 4, 6, 8, 11, 15])),
            format!("c:lands={}", bucket(lands, &[1, 2, 3, 4, 5, 6, 8])),
            format!("c:mana={}", bucket(untapped_mana, &[1, 2, 3, 4, 5, 6, 8])),
            format!("c:myc={}", bucket(my_creatures, &[1, 2, 3, 5, 8])),
            format!("c:oppc={}", bucket(opp_creatures, &[1, 2, 4, 6, 9])),
            format!("c:bestopp={best_opp_creature}"),
            format!("c:life={}", bucket(my_life, &[6, 11, 21, 31])),
            format!("c:opplife={}", bucket(min_opp_life, &[6, 11, 21, 31])),
            format!("c:hand={}", bucket(hand, &[1, 2, 4, 6])),
            format!("c:ncand={}", bucket(candidates as i32, &[2, 3, 5, 8])),
        ];
        PromptContext {
            plain,
            step,
            own_turn,
            stack_foreign,
            untapped_mana,
            lands,
            best_opp_creature,
        }
    }

    fn card_feats(&self, card: &CardDto, card_id: &str, ctx: &PromptContext, f: &mut Feats) {
        f.plain(format!("name={}", card.identity.name));
        for ty in &card.types {
            f.conj(format!("type={ty}"));
        }
        for sub in &card.subtypes {
            f.plain(format!("sub={sub}"));
        }
        for kw in &card.keywords {
            f.plain(format!("kw={}", kw.to_ascii_lowercase()));
        }
        f.conj(format!("cmc={}", card.cmc.min(9)));
        f.conj(format!(
            "spare={}",
            bucket(ctx.untapped_mana - card.cmc, &[-2, 0, 1, 2, 4])
        ));
        f.conj(format!(
            "cmcVlands={}",
            bucket(card.cmc - ctx.lands, &[-3, -1, 0, 1])
        ));
        if self.card_zone(card_id) == Some(ZoneKind::Command) {
            f.conj("zone=command");
            f.plain(format!("cmdTax={}", card.commander_tax.unwrap_or(0).min(4)));
        } else if let Some(zone) = self.card_zone(card_id) {
            f.conj(format!("zone={zone:?}"));
        }
        f.plain(format!("color={}", card.color));
        let text = card.text.to_ascii_lowercase();
        for word in text_tokens(&text) {
            f.plain(format!("w={word}"));
        }
        let patterns: &[(&str, &str)] = &[
            ("destroy target", "removal"),
            ("exile target", "removal"),
            ("deals", "damage"),
            ("counter target", "counter"),
            ("draw", "draw"),
            ("search your library", "tutor"),
            ("create", "token"),
            ("return target", "bounce"),
            ("{t}: add", "manarock"),
            ("each opponent", "eachopp"),
            ("until end of turn", "eot"),
            ("flash", "flash"),
            ("sacrifice", "sac"),
            ("enters", "etb"),
        ];
        for (needle, tag) in patterns {
            if text.contains(needle) {
                f.conj(format!("p={tag}"));
                if *tag == "removal" || *tag == "damage" {
                    f.plain(format!("p={tag}|bestopp={}", ctx.best_opp_creature));
                }
                if *tag == "counter" || *tag == "eot" {
                    f.plain(format!("p={tag}|stackF={}", ctx.stack_foreign));
                }
            }
        }
        let power = card.power.as_deref().and_then(|p| p.parse::<i32>().ok());
        if let Some(power) = power {
            f.plain(format!("pow={}", power.clamp(0, 8)));
        }
    }

    pub(crate) fn candidate_features(
        &self,
        action: Option<&AvailableAction>,
        ctx: &PromptContext,
    ) -> Vec<u32> {
        let mut f = Feats::default();
        match action.map(|a| &a.kind) {
            None => {
                f.conj("kind=pass");
                for c in &ctx.plain {
                    f.plain(format!("pass|{c}"));
                }
            }
            Some(AvailableActionKind::Cast {
                card_id,
                mode,
                label,
            }) => {
                let card = self.card(card_id);
                let is_land = label.starts_with("Play ")
                    || card.is_some_and(|c| c.types.iter().any(|t| t == "Land"));
                f.conj(if is_land { "kind=land" } else { "kind=cast" });
                f.plain(format!("mode={mode:?}"));
                if let Some(card) = card {
                    self.card_feats(card, card_id, ctx, &mut f);
                }
                if !is_land {
                    for c in &ctx.plain {
                        f.plain(format!("cast|{c}"));
                    }
                }
            }
            Some(AvailableActionKind::ActivateAbility(info)) => {
                f.conj("kind=ability");
                if let Some(card) = self.card(&info.card_id) {
                    f.plain(format!("name={}", card.identity.name));
                    f.plain(format!(
                        "abil={}|{}",
                        card.identity.name, info.ability_index
                    ));
                    for ty in &card.types {
                        f.conj(format!("atype={ty}"));
                    }
                }
                let desc = info.description.to_ascii_lowercase();
                for word in text_tokens(&desc) {
                    f.plain(format!("aw={word}"));
                }
                f.conj(format!("acost={}", info.cost.is_some()));
                f.conj(format!("asac={}", desc.contains("sacrifice")));
                f.conj(format!("atap={}", desc.contains("{t}")));
                for c in &ctx.plain {
                    f.plain(format!("abil|{c}"));
                }
            }
            Some(AvailableActionKind::UndoMana { .. }) => {
                f.conj("kind=undo");
            }
        }
        let mut out = Vec::with_capacity(f.plain.len() + 3 * f.conj.len());
        for token in &f.plain {
            out.push(fnv1a(token));
        }
        for token in &f.conj {
            out.push(fnv1a(token));
            out.push(fnv1a(&format!("{token}|step={}", ctx.step)));
            out.push(fnv1a(&format!("{token}|own={}", ctx.own_turn)));
        }
        out
    }
}

impl SimpleAi {
    pub fn set_model(&mut self, json: &str) -> Result<(), String> {
        self.model = Some(LinearModel::from_json(json)?);
        Ok(())
    }

    pub fn has_model(&self) -> bool {
        self.model.is_some()
    }

    pub fn choose_action_features(
        &mut self,
        player_id: &str,
        actions: &[AvailableAction],
    ) -> Vec<(Option<String>, Vec<u32>)> {
        self.ensure_view();
        let candidates: Vec<&AvailableAction> = actions
            .iter()
            .filter(|action| Self::scoreable(action))
            .collect();
        let ctx = self.prompt_context(player_id, candidates.len());
        let mut out: Vec<(Option<String>, Vec<u32>)> = candidates
            .iter()
            .map(|action| {
                (
                    Some(action.id.clone()),
                    self.candidate_features(Some(action), &ctx),
                )
            })
            .collect();
        out.push((None, self.candidate_features(None, &ctx)));
        out
    }

    pub(crate) fn scoreable(action: &AvailableAction) -> bool {
        !matches!(
            &action.kind,
            AvailableActionKind::UndoMana { .. }
                | AvailableActionKind::ActivateAbility(
                    manabrew_protocol::prompts::common::ActivatableAbilityInfo {
                        is_mana_ability: true,
                        ..
                    }
                )
        )
    }
}
