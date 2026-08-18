#[tauri::command]
pub fn is_card_supported(name: String) -> bool {
    crate::card_db::card_name_known(&name)
}

#[tauri::command]
pub fn card_roles(name: String) -> Vec<String> {
    crate::card_db::get_card_db()
        .get_by_card_name(&name)
        .map(manabrew_engine::deck_analysis::classify_card_roles)
        .unwrap_or_default()
}
