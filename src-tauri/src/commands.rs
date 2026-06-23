#[tauri::command]
pub fn is_card_supported(name: String) -> bool {
    crate::card_db::card_name_known(&name)
}
