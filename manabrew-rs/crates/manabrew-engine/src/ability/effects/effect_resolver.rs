//! Effect resolution driver — dispatch on `ApiType` and walk sub-ability chains.
//!
//! Mirrors Java's `AbilityUtils.resolveApiAbility` + the target-context
//! propagation that stack resolution performs in `SpellAbility.resolve`.

use crate::ability::api_type::ApiType;
use crate::ability::spell_ability_effect::SpellAbilityEffect;
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

use super::condition::{check_condition, check_condition_present};
use super::cost_payment::resolve_effect_with_unless_cost;
use super::effect_context::EffectContext;

// Bring every sibling effect submodule into scope so the dispatch macro below
// can reference effect types by short module path, matching Java's flat
// package layout.
use super::*;

/// Generates effect hook dispatch from a single source of truth. Adding a new
/// effect requires only one entry whose right-hand side names the effect's
/// struct (which must implement `SpellAbilityEffect`).
macro_rules! effect_dispatch {
    ( $( $api:path => $handler:path $( [build = $build:path] )? ),* $(,)? ) => {
        /// All API types that have implemented effect handlers.
        /// Used by the fuzz card pool filter to exclude cards with unimplemented effects.
        pub const IMPLEMENTED_API_TYPES: &[ApiType] = &[ $( $api ),* ];

        /// Dispatch Java-parity `SpellAbilityEffect.buildSpellAbility`.
        pub(crate) fn build_spell_ability_for_api(api_type: ApiType, sa: &mut SpellAbility) {
            match api_type {
                $( $api => effect_dispatch!(@build sa, $handler $(, $build)?), )*
                _ => {}
            }
        }

        /// Inner dispatch for a single execution of an effect. Each arm calls
        /// the trait's associated `resolve(ctx, sa)` directly on the struct
        /// — no instance needed (every effect is a unit struct).
        pub(super) fn resolve_effect_once(ctx: &mut EffectContext, sa: &SpellAbility) {
            let api_type = match sa.api {
                Some(api) => api,
                None => {
                    // Some DB/SVar helper nodes intentionally have no API payload.
                    // Java treats those as no-op leafs; avoid warning spam in parity runs.
                    return;
                }
            };
            match api_type {
                $( $api => <$handler as SpellAbilityEffect>::resolve(ctx, sa), )*
                _ => {
                    let err = crate::ability::IllegalAbilityException::new(
                        format!("Unimplemented effect API type: {:?}", api_type),
                    );
                    eprintln!("{}", err);
                }
            }
        }
    };

    (@build $sa:ident, $handler:path, $build:path) => {
        $build($sa)
    };

    (@build $sa:ident, $handler:path) => {
        <$handler as SpellAbilityEffect>::build_spell_ability($sa)
    };
}

effect_dispatch! {
    ApiType::DealDamage => damage_deal_effect::DamageDealEffect,
    ApiType::Branch => branch_effect::BranchEffect,
    ApiType::GainLife => life_gain_effect::LifeGainEffect,
    ApiType::LoseLife => life_lose_effect::LifeLoseEffect,
    ApiType::PutCounter => counters_put_effect::CountersPutEffect,
    ApiType::RemoveCounter => counters_remove_effect::CountersRemoveEffect,
    ApiType::Poison => poison_effect::PoisonEffect,
    ApiType::Pump => pump_effect::PumpEffect,
    ApiType::Destroy => destroy_effect::DestroyEffect,
    ApiType::Draw => draw_effect::DrawEffect,
    ApiType::ChangeZoneAll => change_zone_all_effect::ChangeZoneAllEffect [build = change_zone_all_effect::build_spell_ability],
    ApiType::ChangeZone => change_zone_effect::ChangeZoneEffect [build = change_zone_effect::build_spell_ability],
    ApiType::SacrificeAll => sacrifice_all_effect::SacrificeAllEffect,
    ApiType::Sacrifice => sacrifice_effect::SacrificeEffect,
    ApiType::CopyPermanent => copy_permanent_effect::CopyPermanentEffect,
    ApiType::Token => token_effect::TokenEffect,
    ApiType::Amass => amass_effect::AmassEffect,
    ApiType::Manifest => manifest_effect::ManifestEffect,
    ApiType::ManifestDread => manifest_dread_effect::ManifestDreadEffect,
    ApiType::Cloak => cloak_effect::CloakEffect,
    ApiType::Investigate => investigate_effect::InvestigateEffect,
    ApiType::Incubate => incubate_effect::IncubateEffect,
    ApiType::Seek => seek_effect::SeekEffect,
    ApiType::Learn => learn_effect::LearnEffect,
    ApiType::Discover => discover_effect::DiscoverEffect,
    ApiType::Meld => meld_effect::MeldEffect,
    ApiType::ExchangeControl => control_exchange_effect::ControlExchangeEffect,
    ApiType::ControlPlayer => control_player_effect::ControlPlayerEffect,
    ApiType::Clash => clash_effect::ClashEffect,
    ApiType::Vote => vote_effect::VoteEffect,
    ApiType::VillainousChoice => villainous_choice_effect::VillainousChoiceEffect,
    ApiType::Ascend => ascend_effect::AscendEffect,
    ApiType::DayTime => day_time_effect::DayTimeEffect,
    ApiType::Haunt => haunt_effect::HauntEffect,
    ApiType::Unattach => unattach_effect::UnattachEffect,
    ApiType::FlipOntoBattlefield => flip_onto_battlefield_effect::FlipOntoBattlefieldEffect,
    ApiType::ClassLevelUp => class_level_up_effect::ClassLevelUpEffect,
    ApiType::Venture => venture_effect::VentureEffect,
    ApiType::RingTemptsYou => ring_tempts_you_effect::RingTemptsYouEffect,
    ApiType::Heist => heist_effect::HeistEffect,
    ApiType::ImmediateTrigger => immediate_trigger_effect::ImmediateTriggerEffect,
    ApiType::StoreSVar => store_s_var_effect::StoreSVarEffect,
    ApiType::ChangeTargets => change_targets_effect::ChangeTargetsEffect [build = change_targets_effect::build_spell_ability],
    ApiType::ChangeText => change_text_effect::ChangeTextEffect,
    ApiType::ChangeX => change_x_effect::ChangeXEffect,
    ApiType::CountersMove => counters_move_effect::CountersMoveEffect,
    ApiType::MultiplyCounter => counters_multiply_effect::CountersMultiplyEffect,
    ApiType::CountersNote => counters_note_effect::CountersNoteEffect,
    ApiType::RemoveCounterAll => counters_remove_all_effect::CountersRemoveAllEffect,
    ApiType::ReorderZone => reorder_zone_effect::ReorderZoneEffect,
    ApiType::Repeat => repeat_effect::RepeatEffect,
    ApiType::ReplaceEffect => replace_effect::ReplaceEffect,
    ApiType::BidLife => bid_life_effect::BidLifeEffect,
    ApiType::Block => block_effect::BlockEffect,
    ApiType::Bond => bond_effect::BondEffect,
    ApiType::ChooseCardName => choose_card_name_effect::ChooseCardNameEffect,
    ApiType::ChooseGeneric => choose_generic_effect::ChooseGenericEffect,
    ApiType::ControlSpell => control_spell_effect::ControlSpellEffect [build = control_spell_effect::build_spell_ability],
    ApiType::DamagePrevent => damage_prevent_effect::DamagePreventEffect,
    ApiType::ExchangeLifeVariant => life_exchange_variant_effect::LifeExchangeVariantEffect,
    ApiType::ReplaceDamage => replace_damage_effect::ReplaceDamageEffect,
    ApiType::ReplaceMana => replace_mana_effect::ReplaceManaEffect,
    ApiType::ReplaceCounter => replace_counter_effect::ReplaceCounterEffect,
    ApiType::ReplaceToken => replace_token_effect::ReplaceTokenEffect,
    ApiType::ReplaceSplitDamage => replace_split_damage_effect::ReplaceSplitDamageEffect,
    ApiType::ExchangeTextBox => text_box_exchange_effect::TextBoxExchangeEffect,
    ApiType::SwitchBlock => switch_block_effect::SwitchBlockEffect,
    ApiType::ChangeCombatants => change_combatants_effect::ChangeCombatantsEffect,
    ApiType::Mana => mana_effect::ManaEffect [build = mana_effect::build_spell_ability],
    ApiType::ManaReflected => mana_reflected_effect::ManaReflectedEffect [build = mana_reflected_effect::build_spell_ability],
    ApiType::Mill => mill_effect::MillEffect,
    ApiType::Scry => scry_effect::ScryEffect,
    ApiType::Surveil => surveil_effect::SurveilEffect,
    ApiType::Dig => dig_effect::DigEffect,
    ApiType::DigMultiple => dig_multiple_effect::DigMultipleEffect,
    ApiType::RearrangeTopOfLibrary => rearrange_top_of_library_effect::RearrangeTopOfLibraryEffect,
    ApiType::Reveal => reveal_effect::RevealEffect,
    ApiType::RevealHand => reveal_hand_effect::RevealHandEffect,
    ApiType::LookAt => look_at_effect::LookAtEffect,
    ApiType::Charm => charm_effect::CharmEffect,
    // Java `ApiType.CompanionChoose` binds to `CharmEffect.class` (ApiType.java:214).
    ApiType::CompanionChoose => charm_effect::CharmEffect,
    ApiType::GenericChoice => choose_generic_effect::ChooseGenericEffect,
    ApiType::Plot => plot_effect::PlotEffect,
    ApiType::PeekAndReveal => peek_and_reveal_effect::PeekAndRevealEffect,
    ApiType::SetState => set_state_effect::SetStateEffect,
    ApiType::Cleanup => cleanup_effect::CleanupEffect,
    ApiType::Counter => counter_effect::CounterEffect [build = counter_effect::build_spell_ability],
    ApiType::GainControl => control_gain_effect::ControlGainEffect,
    ApiType::Fight => fight_effect::FightEffect,
    ApiType::Discard => discard_effect::DiscardEffect,
    ApiType::Attach => attach_effect::AttachEffect,
    ApiType::DestroyAll => destroy_all_effect::DestroyAllEffect,
    ApiType::DamageAll => damage_all_effect::DamageAllEffect,
    ApiType::PumpAll => pump_all_effect::PumpAllEffect,
    ApiType::TapAll => tap_all_effect::TapAllEffect,
    ApiType::TapOrUntapAll => tap_or_untap_all_effect::TapOrUntapAllEffect,
    ApiType::UntapAll => untap_all_effect::UntapAllEffect,
    ApiType::Tap => tap_effect::TapEffect,
    ApiType::TapOrUntap => tap_or_untap_effect::TapOrUntapEffect,
    ApiType::Untap => untap_effect::UntapEffect,
    ApiType::SetLife => life_set_effect::LifeSetEffect,
    ApiType::ExchangeLife => life_exchange_effect::LifeExchangeEffect,
    ApiType::WinsGame => game_win_effect::GameWinEffect,
    ApiType::LosesGame => game_loss_effect::GameLossEffect,
    ApiType::GameDrawn => game_draw_effect::GameDrawEffect,
    ApiType::AddTurn => add_turn_effect::AddTurnEffect,
    ApiType::ActivateAbility => activate_ability_effect::ActivateAbilityEffect,
    ApiType::Fog => fog_effect::FogEffect,
    ApiType::ReverseTurnOrder => reverse_turn_order_effect::ReverseTurnOrderEffect,
    ApiType::EndCombatPhase => end_combat_phase_effect::EndCombatPhaseEffect,
    ApiType::EndTurn => end_turn_effect::EndTurnEffect,
    ApiType::ExchangePower => power_exchange_effect::PowerExchangeEffect,
    ApiType::BecomeMonarch => become_monarch_effect::BecomeMonarchEffect,
    ApiType::TakeInitiative => take_initiative_effect::TakeInitiativeEffect,
    ApiType::SkipTurn => skip_turn_effect::SkipTurnEffect,
    ApiType::SkipPhase => skip_phase_effect::SkipPhaseEffect,
    ApiType::AddPhase => add_phase_effect::AddPhaseEffect,
    ApiType::Phases => phases_effect::PhasesEffect,
    ApiType::Regenerate => regenerate_effect::RegenerateEffect,
    ApiType::Play => play_effect::PlayEffect,
    ApiType::Animate => animate_effect::AnimateEffect,
    ApiType::AnimateAll => animate_all_effect::AnimateAllEffect,
    ApiType::Balance => balance_effect::BalanceEffect,
    ApiType::ChooseCard => choose_card_effect::ChooseCardEffect,
    ApiType::ChooseColor => choose_color_effect::ChooseColorEffect,
    ApiType::ChooseDirection => choose_direction_effect::ChooseDirectionEffect,
    ApiType::ChooseEvenOdd => choose_even_odd_effect::ChooseEvenOddEffect,
    ApiType::Clone => clone_effect::CloneEffect,
    ApiType::Connive => connive_effect::ConniveEffect,
    ApiType::GainControlVariant => control_gain_variant_effect::ControlGainVariantEffect,
    ApiType::RepeatEach => repeat_each_effect::RepeatEachEffect,
    ApiType::Shuffle => shuffle_effect::ShuffleEffect,
    ApiType::PutCounterAll => counters_put_all_effect::CountersPutAllEffect,
    ApiType::AddOrRemoveCounter => counters_put_or_remove_effect::CountersPutOrRemoveEffect,
    ApiType::EachDamage => damage_each_effect::DamageEachEffect,
    ApiType::Effect => effect_effect::EffectEffect,
    ApiType::DelayedTrigger => delayed_trigger_effect::DelayedTriggerEffect,
    ApiType::DrainMana => drain_mana_effect::DrainManaEffect,
    ApiType::RemoveFromCombat => remove_from_combat_effect::RemoveFromCombatEffect,
    ApiType::Detain => detain_effect::DetainEffect,
    ApiType::Goad => goad_effect::GoadEffect,
    ApiType::ChoosePlayer => choose_player_effect::ChoosePlayerEffect,
    ApiType::ChooseSource => choose_source_effect::ChooseSourceEffect,
    ApiType::ChooseType => choose_type_effect::ChooseTypeEffect,
    ApiType::NameCard => name_card_effect::NameCardEffect,
    ApiType::ChooseNumber => choose_number_effect::ChooseNumberEffect,
    ApiType::DigUntil => dig_until_effect::DigUntilEffect,
    ApiType::FlipACoin => flip_coin_effect::FlipCoinEffect,
    ApiType::Explore => explore_effect::ExploreEffect,
    ApiType::RollDice => roll_dice_effect::RollDiceEffect,
    ApiType::Protection => protect_effect::ProtectEffect,
    ApiType::ProtectionAll => protect_all_effect::ProtectAllEffect,
    ApiType::PreventDamage => prevent_damage_effect::PreventDamageEffect,
    ApiType::Proliferate => counters_proliferate_effect::CountersProliferateEffect,
    ApiType::MoveCounter => move_counter_effect::MoveCounterEffect,
    ApiType::TimeTravel => time_travel_effect::TimeTravelEffect,
    ApiType::MustBlock => must_block_effect::MustBlockEffect,
    ApiType::CopySpellAbility => copy_spell_ability_effect::CopySpellAbilityEffect [build = copy_spell_ability_effect::build_spell_ability],
    ApiType::TwoPiles => two_piles_effect::TwoPilesEffect,
    ApiType::Encode => encode_effect::EncodeEffect,

    // ── Aliases: variants whose script names map via smart_value_of ────
    ApiType::ExchangeControlVariant => control_gain_variant_effect::ControlGainVariantEffect,
    ApiType::ExchangeZone => change_zone_effect::ChangeZoneEffect,
    ApiType::Regeneration => regenerate_effect::RegenerateEffect,

    // ── Niche/format-specific effects ─────────────────────────────────
    ApiType::Abandon => abandon_effect::AbandonEffect,
    ApiType::AdvanceCrank => advance_crank_effect::AdvanceCrankEffect,
    ApiType::Airbend => airbend_effect::AirbendEffect,
    ApiType::AlterAttribute => alter_attribute_effect::AlterAttributeEffect,
    ApiType::AssembleContraption => assemble_contraption_effect::AssembleContraptionEffect,
    ApiType::AssignGroup => assign_group_effect::AssignGroupEffect,
    ApiType::BecomesBlocked => becomes_blocked_effect::BecomesBlockedEffect,
    ApiType::BlankLine => blank_line_effect::BlankLineEffect,
    ApiType::Blight => blight_effect::BlightEffect,
    ApiType::Camouflage => camouflage_effect::CamouflageEffect,
    ApiType::ChangeSpeed => change_speed_effect::ChangeSpeedEffect,
    ApiType::ChaosEnsues => chaos_ensues_effect::ChaosEnsuesEffect,
    ApiType::ChooseSector => choose_sector_effect::ChooseSectorEffect,
    ApiType::ClaimThePrize => claim_the_prize_effect::ClaimThePrizeEffect,
    ApiType::DamageResolve => damage_resolve_effect::DamageResolveEffect,
    ApiType::Debuff => debuff_effect::DebuffEffect,
    ApiType::Draft => draft_effect::DraftEffect,
    ApiType::Earthbend => earthbend_effect::EarthbendEffect [build = earthbend_effect::build_spell_ability],
    ApiType::Endure => endure_effect::EndureEffect,
    ApiType::GainOwnership => ownership_gain_effect::OwnershipGainEffect,
    ApiType::Intensify => intensify_effect::IntensifyEffect,
    ApiType::LosePerpetual => lose_perpetual_effect::LosePerpetualEffect,
    ApiType::MakeCard => make_card_effect::MakeCardEffect,
    ApiType::MultiplePiles => multiple_piles_effect::MultiplePilesEffect,
    ApiType::Mutate => mutate_effect::MutateEffect,
    ApiType::OpenAttraction => open_attraction_effect::OpenAttractionEffect,
    ApiType::PermanentCreature => permanent_creature_effect::PermanentCreatureEffect,
    ApiType::PermanentNoncreature => permanent_noncreature_effect::PermanentNoncreatureEffect,
    ApiType::Planeswalk => planeswalk_effect::PlaneswalkEffect,
    ApiType::Radiation => radiation_effect::RadiationEffect,
    ApiType::InternalRadiation => internal_radiation_effect::InternalRadiationEffect,
    ApiType::ZoneExchange => zone_exchange_effect::ZoneExchangeEffect,
    ApiType::RemoveFromGame => remove_from_game_effect::RemoveFromGameEffect,
    ApiType::RemoveFromMatch => remove_from_match_effect::RemoveFromMatchEffect,
    ApiType::RestartGame => restart_game_effect::RestartGameEffect,
    ApiType::RollPlanarDice => roll_planar_dice_effect::RollPlanarDiceEffect,
    ApiType::RunChaos => run_chaos_effect::RunChaosEffect,
    ApiType::SetInMotion => set_in_motion_effect::SetInMotionEffect,
    ApiType::Subgame => subgame_effect::SubgameEffect,
    ApiType::UnlockDoor => unlock_door_effect::UnlockDoorEffect,
    ApiType::ChangeZoneResolve => change_zone_resolve_effect::ChangeZoneResolveEffect,
    ApiType::PlayLandVariant => play_land_variant_effect::PlayLandVariantEffect,
}

/// Resolve a single SpellAbility node's effect by dispatching on its API type.
/// Mirrors Java's `AbilityUtils.resolveApiAbility(sa)`.
pub fn resolve_effect(ctx: &mut EffectContext, sa: &SpellAbility) {
    // Check condition gate (e.g. Kicked) — skip this effect if condition not met
    if !check_condition(ctx.game, sa) {
        return;
    }

    // Check ConditionPresent$ / ConditionZone$ / ConditionCompare$ conditions
    let source_id = match sa.source {
        Some(id) => id,
        None => return, // No source card — skip condition check
    };
    if !check_condition_present(ctx.game, sa, sa.activating_player, source_id) {
        return;
    }

    // Handle Repeat$ — repeat the effect N times (for Multikicker/Replicate-like scaling).
    // Mirrors Java's AbilityUtils.handleRepeatParam().
    let repeat_count = if let Some(repeat_val) = sa.ir.repeat.as_deref() {
        match repeat_val {
            "KickerNum" => sa.kick_count as i32,
            _ => 1,
        }
    } else {
        1
    };

    for _ in 0..repeat_count {
        if let Some(unless_cost) = sa
            .ir
            .unless_cost
            .as_deref()
            .map(|s: &str| s.trim())
            .filter(|s| !s.is_empty())
        {
            resolve_effect_with_unless_cost(ctx, sa, unless_cost);
        } else {
            resolve_effect_once(ctx, sa);
        }
    }
}

/// Resolve a SpellAbility and its linked sub-ability chain, inheriting parent
/// card/player targets onto child nodes when those nodes don't choose their own.
/// Mirrors the target-context propagation used by stack resolution.
pub fn resolve_effect_chain_with_parent(
    ctx: &mut EffectContext,
    initial: SpellAbility,
    initial_parent_target_card: Option<CardId>,
    initial_parent_target_player: Option<PlayerId>,
) {
    let mut current = Some(initial);
    let mut parent_target_card = initial_parent_target_card;
    let mut parent_target_player = initial_parent_target_player;
    let mut is_first = true;

    while let Some(sa) = current {
        let mut sa_with_ctx;
        let needs_ctx_clone = !is_first
            && ((parent_target_card.is_some() && sa.target_chosen.target_card.is_none())
                || (parent_target_player.is_some() && sa.target_chosen.target_player.is_none()));
        let sa_ref = if needs_ctx_clone {
            sa_with_ctx = sa.clone();
            if sa_with_ctx.target_chosen.target_card.is_none() {
                sa_with_ctx.target_chosen.target_card = parent_target_card;
            }
            if sa_with_ctx.target_chosen.target_player.is_none() {
                sa_with_ctx.target_chosen.target_player = parent_target_player;
            }
            &sa_with_ctx
        } else {
            &sa
        };

        resolve_effect(ctx, sa_ref);
        parent_target_card = sa_ref.target_chosen.target_card.or(parent_target_card);
        parent_target_player = sa_ref.target_chosen.target_player.or(parent_target_player);
        current = if sub_ability_handled_internally(sa_ref) {
            None
        } else {
            sa.sub_ability.map(|b| *b)
        };
        is_first = false;
        if ctx.game.game_over {
            break;
        }
    }
}

pub fn resolve_effect_chain(ctx: &mut EffectContext, initial: SpellAbility) {
    resolve_effect_chain_with_parent(ctx, initial, None, None);
}

pub(crate) fn sub_ability_handled_internally(sa: &SpellAbility) -> bool {
    sa.ir.unless_cost.is_some()
}
