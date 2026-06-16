use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Ident, ItemFn};

/// Generate the stateless `SpellAbilityEffect` unit struct and trait impl
/// around a resolve function body.
///
/// Usage:
/// `#[spell_effect(FooEffect)] fn resolve(ctx: &mut EffectContext, sa: &SpellAbility) { ... }`
#[proc_macro_attribute]
pub fn spell_effect(attr: TokenStream, item: TokenStream) -> TokenStream {
    let effect_name = parse_macro_input!(attr as Ident);
    let item = parse_macro_input!(item as ItemFn);

    quote! {
        pub struct #effect_name;
        impl crate::ability::spell_ability_effect::SpellAbilityEffect for #effect_name {
            #item
        }
    }
    .into()
}
