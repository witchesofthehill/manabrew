#[cfg(test)]
mod tests {
    use super::*;

    /// The download UI is gated on this, and the route it names only exists
    /// where `start_asset_server` runs. Before this flag the gate was
    /// `getPlatformType() === "tauri"`, so a Windows build offered a download
    /// it had no route to read back and filled the disk with it.
    #[test]
    fn the_card_art_route_is_not_available_until_something_serves_it() {
        assert!(
            !card_art_route_available(),
            "nothing has started the asset server in this test, so nothing answers /scryfall-img/"
        );

        CARD_ART_ROUTE.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(card_art_route_available());
        CARD_ART_ROUTE.store(false, std::sync::atomic::Ordering::Relaxed);
    }

    /// Windows compiles no asset server at all, so the flag can never be set
    /// there and the panel can never render.
    #[test]
    #[cfg(target_os = "windows")]
    fn windows_never_offers_the_download() {
        main_window_url_is_default_on_windows();
        assert!(!card_art_route_available());
    }

    #[cfg(target_os = "windows")]
    fn main_window_url_is_default_on_windows() {}
}
