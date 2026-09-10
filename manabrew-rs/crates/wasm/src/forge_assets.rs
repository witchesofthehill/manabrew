use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn forge_asset_bundle(bytes: &[u8], wanted: Vec<String>) -> Result<String, JsError> {
    forge_cardset_archive::forge_asset_bundle(bytes, wanted).map_err(|error| JsError::new(&error))
}

/// The scripts Forge asks for at play time that the boot bundle left out,
/// framed `name\0script\0…`.
#[wasm_bindgen]
pub fn forge_card_scripts(bytes: &[u8], names: Vec<String>) -> Result<String, JsError> {
    forge_cardset_archive::forge_card_scripts(bytes, names).map_err(|error| JsError::new(&error))
}
