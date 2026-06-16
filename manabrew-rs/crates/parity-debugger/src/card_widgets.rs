//! Card-display widgets shared by the trace, compare, and inspector views.
//!
//! Renders battlefield strips, hand strips, individual card chips, and the
//! selectable-card rows used in the AST/source inspector. Pure rendering — no
//! `App` access, only `ArchiveState`, `CardSnapshot`, and the
//! `Option<InspectedCard>` slot the trace pane wants to write to on click.

use eframe::egui;

use crate::archive::ArchiveState;
use crate::{theme, InspectedCard};

pub(crate) fn render_battlefield_strip(
    ui: &mut egui::Ui,
    battlefield: &[parity::protocol::CardSnapshot],
    archive: Option<&ArchiveState>,
    selected_card_name: Option<&str>,
    selected_card: &mut Option<InspectedCard>,
) {
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing = egui::vec2(4.0, 4.0);
        for card in battlefield {
            let response =
                render_card_chip(ui, card, selected_card_name == Some(card.name.as_str()));
            if response.clicked() {
                select_trace_card(archive, &card.name, selected_card);
            }
        }
    });
}

pub(crate) fn render_hand_strip(
    ui: &mut egui::Ui,
    hand: &[String],
    archive: Option<&ArchiveState>,
    selected_card_name: Option<&str>,
    selected_card: &mut Option<InspectedCard>,
) {
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing = egui::vec2(4.0, 4.0);
        for card_name in hand {
            let response = render_zone_name_chip(
                ui,
                card_name,
                selected_card_name == Some(card_name.as_str()),
            );
            if response.clicked() {
                select_trace_card(archive, card_name, selected_card);
            }
        }
    });
}

pub(crate) fn render_card_chip(
    ui: &mut egui::Ui,
    card: &parity::protocol::CardSnapshot,
    is_selected: bool,
) -> egui::Response {
    let desired_size = egui::vec2(56.0, 78.0);
    let (rect, response) = ui.allocate_exact_size(desired_size, egui::Sense::click());
    let fill = if is_selected {
        theme::BG_SEL
    } else {
        theme::BG_2
    };
    ui.painter().rect_filled(rect, 0.0, fill);
    ui.painter().rect_stroke(
        rect,
        0.0,
        egui::Stroke::new(
            if is_selected { 1.5 } else { 1.0 },
            if is_selected {
                theme::ACCENT
            } else {
                theme::BORDER_STRONG
            },
        ),
    );
    let stripe_rect = egui::Rect::from_min_max(rect.min, egui::pos2(rect.max.x, rect.min.y + 3.0));
    ui.painter().rect_filled(stripe_rect, 0.0, card_color(card));
    let mut child = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(rect.shrink2(egui::vec2(4.0, 5.0)))
            .layout(egui::Layout::top_down(egui::Align::LEFT)),
    );
    child.label(
        egui::RichText::new(short_card_name(&card.name))
            .size(9.0)
            .color(theme::FG_0)
            .strong(),
    );
    let cost_rect = egui::Rect::from_center_size(
        egui::pos2(rect.right() - 10.0, rect.top() + 10.0),
        egui::vec2(13.0, 13.0),
    );
    ui.painter()
        .circle_filled(cost_rect.center(), 6.5, theme::BG_0);
    ui.painter().circle_stroke(
        cost_rect.center(),
        6.5,
        egui::Stroke::new(1.0, card_color(card)),
    );
    if card.tapped {
        child.colored_label(theme::FG_3, "T");
    }
    child.add_space(10.0);
    if let (Some(power), Some(toughness)) = (card.power, card.toughness) {
        child.with_layout(egui::Layout::bottom_up(egui::Align::RIGHT), |ui| {
            let text = egui::RichText::new(format!("{power}/{toughness}"))
                .size(9.0)
                .color(theme::FG_0)
                .background_color(theme::BG_0);
            ui.label(text);
        });
    }
    response
}

pub(crate) fn render_zone_name_chip(
    ui: &mut egui::Ui,
    card_name: &str,
    is_selected: bool,
) -> egui::Response {
    let desired_size = egui::vec2(64.0, 24.0);
    let (rect, response) = ui.allocate_exact_size(desired_size, egui::Sense::click());
    let fill = if is_selected {
        theme::BG_SEL
    } else {
        theme::BG_2
    };
    ui.painter().rect_filled(rect, 0.0, fill);
    ui.painter().rect_stroke(
        rect,
        0.0,
        egui::Stroke::new(
            if is_selected { 1.5 } else { 1.0 },
            if is_selected {
                theme::ACCENT
            } else {
                theme::BORDER_STRONG
            },
        ),
    );
    let mut child = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(rect.shrink2(egui::vec2(5.0, 4.0)))
            .layout(egui::Layout::left_to_right(egui::Align::Center)),
    );
    child.label(
        egui::RichText::new(short_card_name(card_name))
            .size(9.0)
            .color(theme::FG_0)
            .strong(),
    );
    response
}

fn card_color(card: &parity::protocol::CardSnapshot) -> egui::Color32 {
    let name = card.name.to_ascii_lowercase();
    if name.contains("forest") || name.contains("elf") || name.contains("bear") {
        theme::MTG_G
    } else if name.contains("mountain")
        || name.contains("bolt")
        || name.contains("shock")
        || name.contains("goblin")
    {
        theme::MTG_R
    } else if name.contains("plains") {
        theme::MTG_W
    } else if name.contains("island") {
        theme::MTG_U
    } else if name.contains("swamp") {
        theme::MTG_B
    } else {
        theme::MTG_C
    }
}

pub(crate) fn render_selectable_card_row(
    ui: &mut egui::Ui,
    display_text: &str,
    card_name: &str,
    archive: Option<&ArchiveState>,
    is_selected: bool,
    selected_card: &mut Option<InspectedCard>,
) {
    let text = if is_selected {
        egui::RichText::new(display_text)
            .monospace()
            .background_color(egui::Color32::from_rgb(45, 70, 110))
    } else {
        egui::RichText::new(display_text).monospace()
    };
    let response = ui.add(egui::Label::new(text).sense(egui::Sense::click()));
    if response.clicked() {
        select_trace_card(archive, card_name, selected_card);
    }
}

pub(crate) fn select_trace_card(
    archive: Option<&ArchiveState>,
    card_name: &str,
    selected_card: &mut Option<InspectedCard>,
) {
    if let Some(card) = archive.and_then(|state| state.archive().lookup(card_name)) {
        *selected_card = Some(InspectedCard {
            name: card.display_name().to_string(),
            raw: card.raw.to_string(),
        });
    }
}

fn short_card_name(name: &str) -> String {
    const LIMIT: usize = 18;
    if name.chars().count() <= LIMIT {
        return name.to_string();
    }
    let shortened: String = name.chars().take(LIMIT - 1).collect();
    format!("{shortened}…")
}
