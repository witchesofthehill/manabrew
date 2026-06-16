//! Tree-sitter highlighting and AST inspection for the Forge card-script DSL.
//!
//! Provides three things to the rest of the debugger:
//!   - [`highlight_source_job`] — render a source string into an `egui::LayoutJob`
//!     with capture-driven coloring.
//!   - [`tree_sitter_ast_nodes`] / [`AstNodeModel`] — flatten the parse tree into
//!     a depth-tagged list the AST graph view consumes.
//!   - small format / palette helpers used by both.

use eframe::egui;
use streaming_iterator::StreamingIterator;
use tree_sitter::{
    Node as TsNode, Parser as TsParser, Query as TsQuery, QueryCursor as TsQueryCursor,
};

use crate::{shorten_list, theme};

pub(crate) fn highlight_source_job(source: &str) -> egui::text::LayoutJob {
    let mut job = egui::text::LayoutJob::default();
    let spans = tree_sitter_highlight_spans(source).unwrap_or_default();
    let mut cursor = 0;
    for (start, end, format) in spans {
        if start > cursor {
            append_source_segment(&mut job, &source[cursor..start], source_text_format());
        }
        let seg_start = start.max(cursor);
        if end > seg_start {
            append_source_segment(&mut job, &source[seg_start..end], format);
            cursor = end;
        }
    }
    if cursor < source.len() {
        append_source_segment(&mut job, &source[cursor..], source_text_format());
    }
    job
}

pub(crate) fn append_source_segment(
    job: &mut egui::text::LayoutJob,
    text: &str,
    format: egui::TextFormat,
) {
    if !text.is_empty() {
        job.append(text, 0.0, format);
    }
}

pub(crate) fn tree_sitter_highlight_spans(
    source: &str,
) -> Option<Vec<(usize, usize, egui::TextFormat)>> {
    let (tree, language) = parse_tree_sitter(source)?;
    let query = TsQuery::new(&language, tree_sitter_forge_card_script::HIGHLIGHTS_QUERY).ok()?;
    let capture_names = query.capture_names();
    let mut cursor = TsQueryCursor::new();
    let mut captures = cursor.captures(&query, tree.root_node(), source.as_bytes());
    let mut spans = Vec::new();
    while {
        captures.advance();
        captures.get().is_some()
    } {
        if let Some((m, capture_index)) = captures.get() {
            let capture = m.captures[*capture_index];
            let name = capture_names
                .get(capture.index as usize)
                .copied()
                .unwrap_or("");
            let format = capture_text_format(name);
            spans.push((capture.node.start_byte(), capture.node.end_byte(), format));
        }
    }
    spans.sort_by_key(|(start, end, _)| (*start, *end));
    Some(spans)
}

pub(crate) fn parse_tree_sitter(
    source: &str,
) -> Option<(tree_sitter::Tree, tree_sitter::Language)> {
    let language = tree_sitter_forge_card_script::language();
    let mut parser = TsParser::new();
    parser.set_language(&language).ok()?;
    let tree = parser.parse(source, None)?;
    Some((tree, language))
}

pub(crate) fn capture_text_format(capture_name: &str) -> egui::TextFormat {
    match capture_name {
        "keyword" | "keyword.control" => keyword_text_format(),
        "type.builtin" => record_text_format(),
        "function" => source_value_format(),
        "property" | "attribute" | "variable" => field_key_format(),
        "string" | "string.special" => source_value_format(),
        "comment" => comment_text_format(),
        "punctuation.delimiter" | "punctuation.special" | "punctuation.separator" => {
            delimiter_text_format()
        }
        _ => source_text_format(),
    }
}

fn source_text_format() -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::monospace(12.0),
        color: theme::FG_1,
        ..Default::default()
    }
}

fn field_key_format() -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::monospace(12.0),
        color: theme::ACCENT,
        ..Default::default()
    }
}

fn source_value_format() -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::monospace(12.0),
        color: theme::FG_0,
        ..Default::default()
    }
}

fn delimiter_text_format() -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::monospace(12.0),
        color: theme::FG_3,
        ..Default::default()
    }
}

fn comment_text_format() -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::monospace(12.0),
        color: theme::FG_3,
        italics: true,
        ..Default::default()
    }
}

fn keyword_text_format() -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::monospace(12.0),
        color: theme::YELLOW,
        ..Default::default()
    }
}

fn record_text_format() -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::monospace(12.0),
        color: theme::GREEN,
        ..Default::default()
    }
}

pub(crate) struct AstNodeModel {
    pub(crate) line_no: usize,
    pub(crate) depth: usize,
    pub(crate) field_name: Option<String>,
    pub(crate) kind_label: String,
    pub(crate) detail_text: String,
    pub(crate) fill: egui::Color32,
    pub(crate) stroke: egui::Color32,
    pub(crate) entries: Vec<(String, String, egui::Color32)>,
}

pub(crate) fn tree_sitter_ast_nodes(source: &str) -> Option<Vec<AstNodeModel>> {
    let (tree, _) = parse_tree_sitter(source)?;
    let mut out = Vec::new();
    let mut cursor = tree.root_node().walk();
    for node in tree.root_node().named_children(&mut cursor) {
        collect_ts_ast_node(node, source.as_bytes(), 0, None, &mut out);
    }
    Some(out)
}

fn collect_ts_ast_node(
    node: TsNode<'_>,
    source: &[u8],
    depth: usize,
    field_name: Option<String>,
    out: &mut Vec<AstNodeModel>,
) {
    let (fill, stroke) = tree_sitter_node_palette(node.kind());
    out.push(AstNodeModel {
        line_no: node.start_position().row + 1,
        depth,
        field_name,
        kind_label: node.kind().to_string(),
        detail_text: node
            .utf8_text(source)
            .ok()
            .map(|text| shorten_list(text.trim(), 80))
            .unwrap_or_default(),
        fill,
        stroke,
        entries: tree_sitter_leaf_entries(node, source),
    });

    let mut cursor = node.walk();
    for (idx, child) in node.named_children(&mut cursor).enumerate() {
        let child_field = node
            .field_name_for_named_child(idx as u32)
            .map(|s| s.to_string());
        collect_ts_ast_node(child, source, depth + 1, child_field, out);
    }
}

pub(crate) fn tree_sitter_node_palette(kind: &str) -> (egui::Color32, egui::Color32) {
    if kind.contains("ability") {
        (theme::ACCENT_BG, theme::ACCENT)
    } else if kind.contains("trigger") {
        (egui::Color32::from_rgb(82, 72, 40), egui::Color32::GOLD)
    } else if kind.contains("replacement") {
        (egui::Color32::from_rgb(84, 44, 44), theme::RED)
    } else if kind.contains("svar") {
        (egui::Color32::from_rgb(56, 52, 84), theme::JAVA)
    } else if kind.contains("keyword") || kind.contains("specialize") || kind.contains("alternate")
    {
        (theme::BG_1, theme::YELLOW)
    } else if kind.contains("comment") {
        (theme::BG_1, theme::FG_3)
    } else {
        (theme::BG_1, theme::BORDER_STRONG)
    }
}

pub(crate) fn tree_sitter_leaf_entries(
    node: TsNode<'_>,
    source: &[u8],
) -> Vec<(String, String, egui::Color32)> {
    let mut out = Vec::new();
    let mut cursor = node.walk();
    for (idx, child) in node.named_children(&mut cursor).enumerate() {
        if child.named_child_count() == 0 {
            let key = node
                .field_name_for_named_child(idx as u32)
                .unwrap_or(child.kind())
                .to_string();
            let value = child
                .utf8_text(source)
                .ok()
                .map(|text| shorten_list(text.trim(), 36))
                .unwrap_or_default();
            out.push((key, value, tree_sitter_capture_color(child.kind())));
        }
    }
    out
}

pub(crate) fn tree_sitter_capture_color(kind: &str) -> egui::Color32 {
    if matches!(kind, "key" | "param_key" | "svar_name") {
        theme::ACCENT
    } else if matches!(
        kind,
        "value" | "param_value" | "keyword_value" | "svar_value"
    ) {
        theme::FG_0
    } else if kind.contains("record") {
        theme::GREEN
    } else if kind.contains("api") {
        theme::FG_0
    } else {
        theme::FG_2
    }
}
