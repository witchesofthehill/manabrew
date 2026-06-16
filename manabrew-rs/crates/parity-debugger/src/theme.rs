use eframe::egui;

pub const MENU_BAR_HEIGHT: f32 = 30.0;
pub const TOOLBAR_HEIGHT: f32 = 32.0;
pub const STATUS_BAR_HEIGHT: f32 = 22.0;
pub const PANEL_HEADER_HEIGHT: f32 = 22.0;
pub const PANEL_SIDE_PADDING: f32 = 8.0;
pub const PANEL_TOP_PADDING: f32 = 6.0;
pub const PANEL_HEADER_INSET: f32 = 8.0;
pub const LEFT_RAIL_WIDTH: f32 = 320.0;
pub const RIGHT_RAIL_WIDTH: f32 = 360.0;
pub const CHROME_TEXT_SIZE: f32 = 11.0;
pub const BODY_TEXT_SIZE: f32 = 12.0;
pub const SMALL_TEXT_SIZE: f32 = 10.0;

pub const BG_0: egui::Color32 = egui::Color32::from_rgb(32, 35, 40);
pub const BG_1: egui::Color32 = egui::Color32::from_rgb(40, 43, 48);
pub const BG_2: egui::Color32 = egui::Color32::from_rgb(49, 53, 58);
pub const BG_3: egui::Color32 = egui::Color32::from_rgb(60, 65, 72);
pub const BG_HOVER: egui::Color32 = egui::Color32::from_rgb(50, 59, 66);
pub const BG_SEL: egui::Color32 = egui::Color32::from_rgb(41, 100, 122);
pub const BG_FLOAT: egui::Color32 = egui::Color32::from_rgb(37, 40, 45);

pub const FG_0: egui::Color32 = egui::Color32::from_rgb(239, 242, 246);
pub const FG_1: egui::Color32 = egui::Color32::from_rgb(188, 194, 201);
pub const FG_2: egui::Color32 = egui::Color32::from_rgb(144, 151, 160);
pub const FG_3: egui::Color32 = egui::Color32::from_rgb(108, 115, 123);

pub const BORDER: egui::Color32 = egui::Color32::from_rgb(72, 77, 84);
pub const BORDER_STRONG: egui::Color32 = egui::Color32::from_rgb(96, 102, 111);
pub const BORDER_SUBTLE: egui::Color32 = egui::Color32::from_rgb(58, 63, 69);

pub const ACCENT: egui::Color32 = egui::Color32::from_rgb(116, 211, 239);
pub const ACCENT_DIM: egui::Color32 = egui::Color32::from_rgb(67, 156, 184);
pub const ACCENT_BG: egui::Color32 = egui::Color32::from_rgb(46, 87, 103);

pub const RED: egui::Color32 = egui::Color32::from_rgb(238, 99, 99);
pub const YELLOW: egui::Color32 = egui::Color32::from_rgb(232, 198, 92);
pub const GREEN: egui::Color32 = egui::Color32::from_rgb(96, 216, 146);
pub const BLUE: egui::Color32 = egui::Color32::from_rgb(108, 151, 240);
pub const VIOLET: egui::Color32 = egui::Color32::from_rgb(191, 127, 240);
pub const RUST: egui::Color32 = egui::Color32::from_rgb(232, 154, 76);
pub const JAVA: egui::Color32 = egui::Color32::from_rgb(142, 126, 241);
pub const MTG_W: egui::Color32 = egui::Color32::from_rgb(234, 226, 198);
pub const MTG_U: egui::Color32 = egui::Color32::from_rgb(88, 140, 222);
pub const MTG_B: egui::Color32 = egui::Color32::from_rgb(89, 87, 101);
pub const MTG_R: egui::Color32 = egui::Color32::from_rgb(218, 108, 78);
pub const MTG_G: egui::Color32 = egui::Color32::from_rgb(84, 176, 112);
pub const MTG_C: egui::Color32 = egui::Color32::from_rgb(123, 129, 137);

pub fn install(ctx: &egui::Context) {
    let fonts = egui::FontDefinitions::default();
    ctx.set_fonts(fonts);

    let mut style = (*ctx.style()).clone();
    style.override_text_style = Some(egui::TextStyle::Monospace);
    style.spacing.item_spacing = egui::vec2(6.0, 4.0);
    style.spacing.button_padding = egui::vec2(6.0, 2.0);
    style.spacing.menu_margin = egui::Margin::same(4.0);
    style.spacing.indent = 12.0;
    style.spacing.slider_width = 120.0;
    style.spacing.text_edit_width = 140.0;
    style.visuals = visuals();
    style.text_styles = [
        (egui::TextStyle::Heading, egui::FontId::monospace(12.0)),
        (
            egui::TextStyle::Body,
            egui::FontId::monospace(BODY_TEXT_SIZE),
        ),
        (
            egui::TextStyle::Monospace,
            egui::FontId::monospace(BODY_TEXT_SIZE),
        ),
        (
            egui::TextStyle::Button,
            egui::FontId::monospace(CHROME_TEXT_SIZE),
        ),
        (
            egui::TextStyle::Small,
            egui::FontId::monospace(SMALL_TEXT_SIZE),
        ),
    ]
    .into();
    ctx.set_style(style);
}

pub fn panel_frame() -> egui::Frame {
    egui::Frame::default()
        .fill(BG_0)
        .stroke(egui::Stroke::new(1.0, BORDER))
        .inner_margin(egui::Margin::ZERO)
}

pub fn rail_frame() -> egui::Frame {
    egui::Frame::default()
        .fill(BG_0)
        .stroke(egui::Stroke::NONE)
        .inner_margin(egui::Margin::ZERO)
}

fn visuals() -> egui::Visuals {
    let mut visuals = egui::Visuals::dark();
    visuals.override_text_color = Some(FG_1);
    visuals.faint_bg_color = BG_1;
    visuals.extreme_bg_color = BG_0;
    visuals.code_bg_color = BG_0;
    visuals.panel_fill = BG_0;
    visuals.window_fill = BG_0;
    visuals.selection.bg_fill = ACCENT_BG;
    visuals.selection.stroke = egui::Stroke::new(1.0, ACCENT);
    visuals.hyperlink_color = ACCENT;
    visuals.widgets.noninteractive = widget_visuals(BG_0, BORDER, FG_1);
    visuals.widgets.inactive = widget_visuals(BG_1, BORDER, FG_1);
    visuals.widgets.hovered = widget_visuals(BG_HOVER, BORDER_STRONG, FG_0);
    visuals.widgets.active = widget_visuals(BG_SEL, ACCENT, FG_0);
    visuals.widgets.open = widget_visuals(BG_2, BORDER_STRONG, FG_0);
    visuals.window_stroke = egui::Stroke::new(1.0, BORDER);
    visuals.menu_rounding = egui::Rounding::ZERO;
    visuals.window_rounding = egui::Rounding::ZERO;
    visuals
}

fn widget_visuals(
    bg_fill: egui::Color32,
    stroke: egui::Color32,
    fg_stroke: egui::Color32,
) -> egui::style::WidgetVisuals {
    egui::style::WidgetVisuals {
        weak_bg_fill: bg_fill,
        bg_fill,
        bg_stroke: egui::Stroke::new(1.0, stroke),
        rounding: egui::Rounding::ZERO,
        fg_stroke: egui::Stroke::new(1.0, fg_stroke),
        expansion: 0.0,
    }
}
