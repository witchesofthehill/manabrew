// Core types (extracted from replacement_effect.rs to match Java file structure)
pub mod replacement_layer;
pub mod replacement_result;
pub mod replacement_type;

// Replacement effect struct + parser
pub mod replacement_effect;

// Handler (dispatcher)
pub mod replacement_handler;

// ── Replace* subclass modules (1:1 with Java Replace*.java) ──────────────────

// Fully implemented
pub mod replace_add_counter;
pub mod replace_counter;
pub mod replace_damage;
pub mod replace_destroy;
pub mod replace_draw;
pub mod replace_gain_life;
pub mod replace_game_loss;
pub mod replace_game_win;
pub mod replace_moved;
pub mod replace_produce_mana;
pub mod replace_token;

// Format/mechanic-specific replacement modules
pub mod replace_assemble_contraption;
pub mod replace_assign_deal_damage;
pub mod replace_attached;
pub mod replace_begin_phase;
pub mod replace_begin_turn;
pub mod replace_cascade;
pub mod replace_copy_spell;
pub mod replace_dealt_damage;
pub mod replace_declare_blocker;
pub mod replace_draw_cards;
pub mod replace_explore;
pub mod replace_learn;
pub mod replace_life_reduced;
pub mod replace_lose_mana;
pub mod replace_mill;
pub mod replace_pay_life;
pub mod replace_planar_dice_result;
pub mod replace_planeswalk;
pub mod replace_proliferate;
pub mod replace_remove_counter;
pub mod replace_roll_dice;
pub mod replace_roll_planar_dice;
pub mod replace_scry;
pub mod replace_set_in_motion;
pub mod replace_tap;
pub mod replace_transform;
pub mod replace_turn_face_up;
pub mod replace_untap;

// Re-export all public types for convenience
pub use replacement_effect::*;
pub use replacement_handler::*;
pub use replacement_layer::ReplacementLayer;
pub use replacement_result::ReplacementResult;
pub use replacement_type::ReplacementType;
