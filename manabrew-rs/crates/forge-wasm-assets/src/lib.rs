use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn forge_asset_bundle(bytes: &[u8], wanted: Vec<String>) -> Result<String, JsError> {
    forge_cardset_archive::forge_asset_bundle(bytes, wanted).map_err(|error| JsError::new(&error))
}
