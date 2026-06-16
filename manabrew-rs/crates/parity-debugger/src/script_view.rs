//! Card-script viewer: renders parsed `ScriptLine`s into the egui inspector.
//!
//! Surfaces the parsed AST, the per-line summary (ability records, triggers,
//! statics, replacements, SVars, keywords), and parser diagnostics. Pure
//! rendering — no `App` access, only `ParsedCardScript<\'_>` data and the
//! AST view mode.

use eframe::egui;
use forge_card_script::{
    ParamEntry, ParsedCardScript, ScriptAbility, ScriptAbilityRecord, ScriptDiagnostic,
    ScriptDiagnosticKind, ScriptLineKind, ScriptParamRecord, ScriptSVar, ScriptSVarValue,
    SemanticAmount, SemanticParamValue, SemanticParamValueKind,
};

use crate::ts_view::{tree_sitter_ast_nodes, AstNodeModel};
use crate::{render_selection_highlight_frame, shorten_list, theme, AstViewMode};

pub(crate) fn render_summary(ui: &mut egui::Ui, parsed: &ParsedCardScript<'_>) {
    let mut fields = Vec::new();
    let mut abilities = Vec::new();
    let mut trigger_count = 0usize;
    let mut static_count = 0usize;
    let mut replacement_count = 0usize;
    let mut svar_count = 0usize;
    let mut unknown_count = 0usize;

    for line in parsed.lines() {
        match &line.kind {
            ScriptLineKind::Field(field) => fields.push((field.key, field.value.unwrap_or(""))),
            ScriptLineKind::Ability(ability) => abilities.push((line.line_no, ability)),
            ScriptLineKind::Trigger(_) => trigger_count += 1,
            ScriptLineKind::StaticAbility(_) => static_count += 1,
            ScriptLineKind::Replacement(_) => replacement_count += 1,
            ScriptLineKind::SVar(_) => svar_count += 1,
            ScriptLineKind::Unknown(_) => unknown_count += 1,
            _ => {}
        }
    }

    egui::Grid::new("card_summary_fields")
        .num_columns(2)
        .spacing([12.0, 4.0])
        .show(ui, |ui| {
            for key in [
                "Name", "ManaCost", "Types", "PT", "Colors", "Loyalty", "Oracle", "Text",
            ] {
                if let Some(value) = field_value(&fields, key) {
                    ui.strong(key);
                    ui.label(value);
                    ui.end_row();
                }
            }
        });

    ui.separator();
    ui.horizontal_wrapped(|ui| {
        ui.weak(format!("lines: {}", parsed.lines().len()));
        ui.weak(format!("diagnostics: {}", parsed.diagnostics().len()));
        ui.weak(format!("abilities: {}", abilities.len()));
        ui.weak(format!("triggers: {trigger_count}"));
        ui.weak(format!("static: {static_count}"));
        ui.weak(format!("replacement: {replacement_count}"));
        ui.weak(format!("svars: {svar_count}"));
        if unknown_count > 0 {
            ui.colored_label(
                egui::Color32::YELLOW,
                format!("unknown fields: {unknown_count}"),
            );
        }
    });

    if !abilities.is_empty() {
        egui::CollapsingHeader::new(format!("Ability Outline ({})", abilities.len()))
            .default_open(true)
            .show(ui, |ui| {
                for (line_no, ability) in abilities {
                    let record = ability.record.map(record_label).unwrap_or("A?");
                    let api = ability.api_raw.unwrap_or("?");
                    let summary = ability_summary(ability);
                    ui.horizontal_wrapped(|ui| {
                        ui.monospace(format!("L{line_no:>3}"));
                        ui.colored_label(egui::Color32::LIGHT_BLUE, format!("{record}${api}"));
                        if !summary.is_empty() {
                            ui.weak(summary);
                        }
                    });
                }
            });
    }
}

pub(crate) fn render_ast(
    ui: &mut egui::Ui,
    parsed: &ParsedCardScript<'_>,
    selected_card_name: Option<&str>,
    ast_view_mode: &mut AstViewMode,
) {
    render_selection_highlight_frame(
        ui,
        selected_card_name.is_some(),
        selected_card_name.map(|name| format!("trace selection · {name}")),
        |ui| {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 4.0;
                ui.label(
                    egui::RichText::new("View")
                        .size(theme::SMALL_TEXT_SIZE)
                        .color(theme::FG_3),
                );
                ui.selectable_value(ast_view_mode, AstViewMode::Graph, "Graph");
                ui.selectable_value(ast_view_mode, AstViewMode::Text, "Text");
            });
            ui.add_space(6.0);
            ui.set_width(ui.available_width());
            let diagnostics = parsed.diagnostics();
            let header = if diagnostics.is_empty() {
                "Diagnostics (0)".to_string()
            } else {
                format!("Diagnostics ({})", diagnostics.len())
            };
            egui::CollapsingHeader::new(header)
                .default_open(!diagnostics.is_empty())
                .show(ui, |ui| {
                    if diagnostics.is_empty() {
                        ui.weak("No issues.");
                    } else {
                        for d in diagnostics {
                            render_diagnostic(ui, d);
                        }
                    }
                });

            ui.separator();
            match ast_view_mode {
                AstViewMode::Graph => render_ast_graph(ui, parsed),
                AstViewMode::Text => render_ast_text(ui, parsed),
            }
        },
    );
}

pub(crate) fn render_ast_graph(ui: &mut egui::Ui, parsed: &ParsedCardScript<'_>) {
    let graph_nodes = tree_sitter_ast_nodes(parsed.raw()).unwrap_or_default();
    if graph_nodes.is_empty() {
        ui.colored_label(theme::FG_3, "No AST nodes.");
        return;
    }

    let max_depth = graph_nodes.iter().map(|node| node.depth).max().unwrap_or(0);
    let max_entries = graph_nodes
        .iter()
        .map(|node| node.entries.len())
        .max()
        .unwrap_or(0);
    let canvas_width = ui
        .available_width()
        .max(520.0 + max_depth as f32 * 140.0 + max_entries as f32 * 56.0);
    ui.set_min_width(canvas_width);
    ui.set_width(canvas_width);

    for (idx, node) in graph_nodes.iter().enumerate() {
        render_ast_node(ui, node);
        if idx + 1 < graph_nodes.len() {
            let (rect, _) =
                ui.allocate_exact_size(egui::vec2(canvas_width, 12.0), egui::Sense::hover());
            ui.painter().vline(
                rect.left() + 12.0 + node.depth as f32 * 18.0,
                rect.y_range(),
                egui::Stroke::new(1.0, theme::BORDER_STRONG),
            );
        }
    }
}

pub(crate) fn render_ast_node(ui: &mut egui::Ui, node: &AstNodeModel) {
    ui.horizontal(|ui| {
        ui.add_space(node.depth as f32 * 18.0);
        theme::panel_frame()
            .fill(node.fill)
            .stroke(egui::Stroke::new(1.0, node.stroke))
            .inner_margin(egui::Margin {
                left: 10.0,
                right: 10.0,
                top: 8.0,
                bottom: 8.0,
            })
            .show(ui, |ui| {
                ui.set_min_width(340.0);
                ui.horizontal(|ui| {
                    ui.colored_label(theme::FG_3, format!("L{:>3}", node.line_no));
                    if let Some(field_name) = &node.field_name {
                        ui.colored_label(theme::FG_2, format!("{field_name}:"));
                    }
                    ui.label(
                        egui::RichText::new(&node.kind_label)
                            .strong()
                            .color(theme::FG_0),
                    );
                    if !node.detail_text.is_empty() {
                        ui.colored_label(theme::FG_2, shorten_list(&node.detail_text, 72));
                    }
                });
                if !node.entries.is_empty() {
                    ui.add_space(4.0);
                    ui.horizontal_wrapped(|ui| {
                        ui.spacing_mut().item_spacing = egui::vec2(4.0, 4.0);
                        for (key, value, color) in &node.entries {
                            render_ast_param_pill(ui, key, value, *color);
                        }
                    });
                }
            });
    });
}

pub(crate) fn render_ast_text(ui: &mut egui::Ui, parsed: &ParsedCardScript<'_>) {
    let graph_nodes = tree_sitter_ast_nodes(parsed.raw()).unwrap_or_default();
    if graph_nodes.is_empty() {
        ui.colored_label(theme::FG_3, "No AST nodes.");
        return;
    }

    for node in &graph_nodes {
        ui.horizontal_wrapped(|ui| {
            ui.add_space(node.depth as f32 * 16.0);
            ui.colored_label(theme::FG_3, format!("L{:>3}", node.line_no));
            if let Some(field_name) = &node.field_name {
                ui.colored_label(theme::FG_2, format!("{field_name}:"));
            }
            ui.label(
                egui::RichText::new(&node.kind_label)
                    .monospace()
                    .color(theme::FG_0)
                    .strong(),
            );
            if !node.detail_text.is_empty() {
                ui.colored_label(theme::FG_2, &node.detail_text);
            }
        });
        if !node.entries.is_empty() {
            ui.horizontal_wrapped(|ui| {
                ui.add_space(node.depth as f32 * 16.0 + 24.0);
                ui.spacing_mut().item_spacing = egui::vec2(6.0, 4.0);
                for (key, value, color) in &node.entries {
                    render_ast_param_pill(ui, key, value, *color);
                }
            });
        }
        ui.add_space(4.0);
    }
}

fn record_label(record: ScriptAbilityRecord) -> &'static str {
    match record {
        ScriptAbilityRecord::Activated => "AB",
        ScriptAbilityRecord::Spell => "SP",
        ScriptAbilityRecord::SubAbility => "DB",
        ScriptAbilityRecord::StaticAbility => "ST",
    }
}

fn kind_label(kind: SemanticParamValueKind) -> &'static str {
    match kind {
        SemanticParamValueKind::AbilityRecord => "AbilityRecord",
        SemanticParamValueKind::Symbol => "Symbol",
        SemanticParamValueKind::Boolean => "Bool",
        SemanticParamValueKind::Integer => "Int",
        SemanticParamValueKind::Amount => "Amount",
        SemanticParamValueKind::ZoneList => "ZoneList",
        SemanticParamValueKind::Selector => "Selector",
        SemanticParamValueKind::Reference => "Reference",
        SemanticParamValueKind::SVarReference => "SVarRef",
        SemanticParamValueKind::Cost => "Cost",
        SemanticParamValueKind::Text => "Text",
        SemanticParamValueKind::DelimitedList => "List",
        SemanticParamValueKind::Transform => "Transform",
        SemanticParamValueKind::Comparison => "Compare",
        SemanticParamValueKind::Expression => "Expr",
        SemanticParamValueKind::Raw => "Raw",
    }
}

fn kind_color(kind: SemanticParamValueKind) -> egui::Color32 {
    match kind {
        SemanticParamValueKind::Integer | SemanticParamValueKind::Amount => {
            egui::Color32::LIGHT_BLUE
        }
        SemanticParamValueKind::Boolean => egui::Color32::LIGHT_YELLOW,
        SemanticParamValueKind::Selector | SemanticParamValueKind::Reference => {
            egui::Color32::LIGHT_GREEN
        }
        SemanticParamValueKind::SVarReference => egui::Color32::from_rgb(220, 180, 255),
        SemanticParamValueKind::Cost => egui::Color32::GOLD,
        SemanticParamValueKind::ZoneList => egui::Color32::from_rgb(180, 200, 240),
        SemanticParamValueKind::Text => egui::Color32::GRAY,
        _ => egui::Color32::LIGHT_GRAY,
    }
}

fn short_value(value: &SemanticParamValue<'_>, raw: &str) -> String {
    match value {
        SemanticParamValue::Amount(a) => match a {
            SemanticAmount::Literal(n) => format!("{n}"),
            SemanticAmount::X => "X".into(),
            SemanticAmount::Any => "Any".into(),
            SemanticAmount::All => "All".into(),
            SemanticAmount::SVar(s) => format!("SVar({s})"),
            SemanticAmount::Expression(e) => format!("expr({e})"),
        },
        SemanticParamValue::Integer(n) => format!("{n}"),
        SemanticParamValue::Boolean(b) => format!("{b}"),
        SemanticParamValue::Selector(sel) | SemanticParamValue::Reference(sel) => {
            let alts: Vec<String> = sel
                .alternatives
                .iter()
                .map(|alt| {
                    let parts: Vec<String> = alt
                        .parts
                        .iter()
                        .map(|p| match p.separator {
                            Some(c) => format!("{c}{}", p.value),
                            None => p.value.to_string(),
                        })
                        .collect();
                    parts.join("")
                })
                .collect();
            alts.join(" | ")
        }
        SemanticParamValue::ZoneList(zones) => zones.join(", "),
        SemanticParamValue::SVarReference(refs) => refs.join(", "),
        SemanticParamValue::DelimitedList(items) => items.join(", "),
        SemanticParamValue::Transform(t) => format!("{} → {}", t.from, t.to),
        SemanticParamValue::Comparison(c) => format!("{} {:?} {}", c.left, c.operator, c.right),
        _ => raw.to_string(),
    }
}

fn field_value<'a>(fields: &[(&'a str, &'a str)], key: &str) -> Option<&'a str> {
    fields
        .iter()
        .rev()
        .find_map(|(field_key, value)| (*field_key == key).then_some(*value))
}

fn ability_summary(ability: &ScriptAbility<'_>) -> String {
    let mut parts = Vec::new();
    if let Some(cost) = ability.params.get("Cost") {
        parts.push(format!("Cost {cost}"));
    }
    if let Some(valid_tgts) = ability.params.get("ValidTgts") {
        parts.push(format!("Targets {valid_tgts}"));
    }
    if let Some(description) = ability
        .params
        .get("SpellDescription")
        .or_else(|| ability.params.get("StackDescription"))
        .or_else(|| ability.params.get("Description"))
    {
        parts.push(description.to_string());
    }
    parts.join("  |  ")
}

fn semantic_entries(entries: &[ParamEntry<'_>]) -> Vec<(String, String, egui::Color32)> {
    entries
        .iter()
        .map(|entry| {
            let semantic = entry.semantic();
            (
                entry.key.to_string(),
                short_value(&semantic.value, entry.value),
                kind_color(semantic.value.kind()),
            )
        })
        .collect()
}

pub(crate) fn render_ast_param_pill(
    ui: &mut egui::Ui,
    key: &str,
    value: &str,
    color: egui::Color32,
) {
    egui::Frame::none()
        .fill(theme::BG_0)
        .stroke(egui::Stroke::new(1.0, color))
        .inner_margin(egui::Margin {
            left: 5.0,
            right: 5.0,
            top: 2.0,
            bottom: 2.0,
        })
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.colored_label(color, egui::RichText::new(key).size(10.0).strong());
                ui.colored_label(
                    theme::FG_1,
                    egui::RichText::new(shorten_list(&value, 28)).size(10.0),
                );
            });
        });
}

pub(crate) fn render_ability(ui: &mut egui::Ui, line_no: usize, ability: &ScriptAbility<'_>) {
    let record = ability.record.map(record_label).unwrap_or("A?");
    let api = ability.api_raw.unwrap_or("?");
    let header = format!("L{line_no:>3}  {record}${api}");
    egui::CollapsingHeader::new(header)
        .id_salt(("ability", line_no))
        .default_open(true)
        .show(ui, |ui| {
            render_params(ui, ability.params.entries());
        });
}

pub(crate) fn render_param_record(
    ui: &mut egui::Ui,
    line_no: usize,
    tag: &str,
    color: egui::Color32,
    rec: &ScriptParamRecord<'_>,
) {
    let header = egui::RichText::new(format!(
        "L{line_no:>3}  {tag}: ({} params)",
        rec.params.entries().len()
    ))
    .color(color);
    egui::CollapsingHeader::new(header)
        .id_salt((tag, line_no))
        .default_open(true)
        .show(ui, |ui| {
            render_params(ui, rec.params.entries());
        });
}

pub(crate) fn render_svar(ui: &mut egui::Ui, line_no: usize, svar: &ScriptSVar<'_>) {
    let header = format!("L{line_no:>3}  SVar: {}", svar.name);
    egui::CollapsingHeader::new(header)
        .id_salt(("svar", line_no))
        .default_open(false)
        .show(ui, |ui| match &svar.value_kind {
            ScriptSVarValue::Ability(ability) => {
                let record = ability.record.map(record_label).unwrap_or("A?");
                let api = ability.api_raw.unwrap_or("?");
                ui.label(format!("{record}${api}"));
                render_params(ui, ability.params.entries());
            }
            ScriptSVarValue::Params(rec) => {
                render_params(ui, rec.params.entries());
            }
            ScriptSVarValue::Raw(raw) => {
                ui.monospace(*raw);
            }
        });
}

pub(crate) fn render_params(ui: &mut egui::Ui, entries: &[ParamEntry<'_>]) {
    if entries.is_empty() {
        ui.weak("(no params)");
        return;
    }
    for entry in entries {
        let sem = entry.semantic();
        ui.horizontal_wrapped(|ui| {
            ui.strong(entry.key);
            ui.colored_label(kind_color(sem.value.kind()), kind_label(sem.value.kind()));
            ui.monospace(short_value(&sem.value, entry.value));
        });
        ui.add_space(2.0);
    }
}

pub(crate) fn render_diagnostic(ui: &mut egui::Ui, d: &ScriptDiagnostic<'_>) {
    use forge_card_script::{ParamDiagnosticKind, ScriptDiagnosticKind};
    let (color, label) = match d.kind {
        ScriptDiagnosticKind::MissingColon => (egui::Color32::LIGHT_RED, "missing ':'"),
        ScriptDiagnosticKind::EmptyKey => (egui::Color32::YELLOW, "empty key"),
        ScriptDiagnosticKind::UnknownField => (egui::Color32::YELLOW, "unknown field"),
        ScriptDiagnosticKind::MissingAbilityRecord => {
            (egui::Color32::LIGHT_RED, "missing ability record")
        }
        ScriptDiagnosticKind::MissingSVarName => (egui::Color32::LIGHT_RED, "missing SVar name"),
        ScriptDiagnosticKind::Param(p) => match p {
            ParamDiagnosticKind::MissingDelimiter => {
                (egui::Color32::LIGHT_RED, "param: missing '$'")
            }
            ParamDiagnosticKind::EmptyKey => (egui::Color32::YELLOW, "param: empty key"),
            ParamDiagnosticKind::DuplicateKeySameValue => {
                (egui::Color32::LIGHT_GRAY, "param: duplicate (same value)")
            }
            ParamDiagnosticKind::DuplicateKeyDifferentValue => {
                (egui::Color32::YELLOW, "param: duplicate (different value)")
            }
        },
    };
    ui.horizontal(|ui| {
        ui.monospace(format!("L{:>3}", d.line_no));
        ui.colored_label(color, label);
        if let Some(key) = d.key {
            ui.monospace(key);
        }
        ui.weak(d.segment);
    });
}
