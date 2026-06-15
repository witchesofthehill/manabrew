use std::collections::HashMap;
use std::sync::Arc;

use dashmap::DashMap;
use forge_card_script::{ParsedCardScript, ScriptDiagnostic, ScriptDiagnosticKind, ScriptLineKind};
use ropey::Rope;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::*;
use tower_lsp::{Client, LanguageServer, LspService, Server};

// ── Document state ──────────────────────────────────────────────

/// Per-document state stored by the server.
struct Document {
    rope: Rope,
    /// SVar name → (line, byte span of name, byte span of value)
    svars: HashMap<String, SvarInfo>,
}

struct SvarInfo {
    name_start: u32,
    name_end: u32,
    value_start: u32,
    value_end: u32,
}

impl Document {
    fn new(text: &str) -> Self {
        let rope = Rope::from_str(text);
        let svars = Self::collect_svars(text);
        Document { rope, svars }
    }

    fn collect_svars(text: &str) -> HashMap<String, SvarInfo> {
        let parsed = ParsedCardScript::parse(text);
        let mut svars = HashMap::new();

        for line in parsed.lines() {
            if let ScriptLineKind::SVar(svar) = &line.kind {
                svars.insert(
                    svar.name.to_string(),
                    SvarInfo {
                        name_start: svar.name_span.start as u32,
                        name_end: svar.name_span.end as u32,
                        value_start: svar.value_span.start as u32,
                        value_end: svar.value_span.end as u32,
                    },
                );
            }
        }

        svars
    }
}

// ── Server ──────────────────────────────────────────────────────

struct Backend {
    client: Client,
    documents: DashMap<Url, Arc<Document>>,
}

impl Backend {
    fn new(client: Client) -> Self {
        Backend {
            client,
            documents: DashMap::new(),
        }
    }

    /// Parse a document and publish diagnostics.
    async fn on_change(&self, uri: Url, text: &str, version: Option<i32>) {
        let doc = Arc::new(Document::new(text));
        self.documents.insert(uri.clone(), doc);

        let diagnostics = self.compute_diagnostics(text);
        self.client
            .publish_diagnostics(uri, diagnostics, version)
            .await;
    }

    fn compute_diagnostics(&self, text: &str) -> Vec<Diagnostic> {
        let rope = Rope::from_str(text);
        let parsed = ParsedCardScript::parse(text);
        parsed
            .diagnostics()
            .iter()
            .filter_map(|d| self.to_lsp_diagnostic(&rope, d))
            .collect()
    }

    fn to_lsp_diagnostic(&self, rope: &Rope, d: &ScriptDiagnostic<'_>) -> Option<Diagnostic> {
        let start = byte_to_position(rope, d.span.start);
        let end = byte_to_position(rope, d.span.end);

        let (severity, message) = match d.kind {
            ScriptDiagnosticKind::MissingColon => (
                DiagnosticSeverity::ERROR,
                "Missing ':' delimiter".to_string(),
            ),
            ScriptDiagnosticKind::EmptyKey => {
                (DiagnosticSeverity::WARNING, "Empty key".to_string())
            }
            ScriptDiagnosticKind::UnknownField => (
                DiagnosticSeverity::WARNING,
                format!("Unknown field: {}", d.key.unwrap_or("?")),
            ),
            ScriptDiagnosticKind::MissingAbilityRecord => (
                DiagnosticSeverity::ERROR,
                "Ability line missing record type (AB$, SP$, DB$, ST$)".to_string(),
            ),
            ScriptDiagnosticKind::MissingSVarName => {
                (DiagnosticSeverity::ERROR, "SVar missing name".to_string())
            }
            ScriptDiagnosticKind::Param(pk) => {
                use forge_card_script::ParamDiagnosticKind;
                match pk {
                    ParamDiagnosticKind::MissingDelimiter => (
                        DiagnosticSeverity::ERROR,
                        "Param missing '$' delimiter".to_string(),
                    ),
                    ParamDiagnosticKind::EmptyKey => {
                        (DiagnosticSeverity::WARNING, "Empty param key".to_string())
                    }
                    ParamDiagnosticKind::DuplicateKeySameValue => (
                        DiagnosticSeverity::HINT,
                        format!("Duplicate param '{}' with same value", d.key.unwrap_or("?")),
                    ),
                    ParamDiagnosticKind::DuplicateKeyDifferentValue => (
                        DiagnosticSeverity::WARNING,
                        format!(
                            "Duplicate param '{}' with different value (last wins)",
                            d.key.unwrap_or("?")
                        ),
                    ),
                }
            }
        };

        Some(Diagnostic {
            range: Range { start, end },
            severity: Some(severity),
            source: Some("forge-card-script".to_string()),
            message,
            ..Default::default()
        })
    }

    /// Find the SVar name at a byte column within a line (for go-to-def and hover).
    fn svar_ref_at_position<'a>(&self, line_text: &'a str, col: usize) -> Option<&'a str> {
        // Look for patterns like Execute$ Name, SubAbility$ Name, etc.
        // Find the $ before cursor or the value after $
        for segment in line_text.split('|') {
            let segment_trimmed = segment.trim();
            if let Some(dollar) = segment_trimmed.find('$') {
                let value = segment_trimmed[dollar + 1..].trim();
                // Check if cursor is within this value region
                let seg_start = line_text.find(segment).unwrap_or(0);
                let val_start = seg_start + segment.find(value).unwrap_or(0);
                let val_end = val_start + value.len();

                if col >= val_start && col <= val_end {
                    let key = segment_trimmed[..dollar].trim();
                    if is_svar_ref_key(key) {
                        // Handle comma/ampersand separated refs
                        for part in value.split([',', '&']) {
                            let part = part.trim();
                            let part_start = val_start + value.find(part).unwrap_or(0);
                            let part_end = part_start + part.len();
                            if col >= part_start && col <= part_end {
                                return Some(part);
                            }
                        }
                        return Some(value);
                    }
                }
            }
        }
        None
    }
}

fn is_svar_ref_key(key: &str) -> bool {
    key == "Execute"
        || key == "SubAbility"
        || key == "TrueSubAbility"
        || key == "FalseSubAbility"
        || key == "ReplaceWith"
        || key == "TokenScript"
        || key.ends_with("SubAbility")
        || key.ends_with("Ability")
        || key.ends_with("Abilities")
        || key.ends_with("SVar")
        || key.ends_with("Subs")
        || key.starts_with("AddTrigger")
        || key.starts_with("AddStaticAbility")
}

/// Convert an absolute byte offset into an LSP position (line + UTF-16 column).
fn byte_to_position(rope: &Rope, byte: usize) -> Position {
    let byte = byte.min(rope.len_bytes());
    let line = rope.byte_to_line(byte);
    let line_start = rope.char_to_utf16_cu(rope.line_to_char(line));
    let col = rope.char_to_utf16_cu(rope.byte_to_char(byte)) - line_start;
    Position::new(line as u32, col as u32)
}

/// Convert an LSP position (line + UTF-16 column) into an absolute byte offset.
fn position_to_byte(rope: &Rope, pos: Position) -> usize {
    let line = (pos.line as usize).min(rope.len_lines().saturating_sub(1));
    let line_start = rope.char_to_utf16_cu(rope.line_to_char(line));
    let max = rope.char_to_utf16_cu(rope.len_chars());
    let target = (line_start + pos.character as usize).min(max);
    rope.char_to_byte(rope.utf16_cu_to_char(target))
}

// ── LanguageServer trait ────────────────────────────────────────

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, _: InitializeParams) -> Result<InitializeResult> {
        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::FULL,
                )),
                hover_provider: Some(HoverProviderCapability::Simple(true)),
                definition_provider: Some(OneOf::Left(true)),
                diagnostic_provider: Some(DiagnosticServerCapabilities::Options(
                    DiagnosticOptions {
                        identifier: Some("forge-card-script".to_string()),
                        inter_file_dependencies: false,
                        workspace_diagnostics: false,
                        ..Default::default()
                    },
                )),
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn initialized(&self, _: InitializedParams) {
        self.client
            .log_message(MessageType::INFO, "Forge Card Script LSP initialized")
            .await;
    }

    async fn shutdown(&self) -> Result<()> {
        Ok(())
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        let uri = params.text_document.uri;
        let text = params.text_document.text;
        self.on_change(uri, &text, Some(params.text_document.version))
            .await;
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        let uri = params.text_document.uri;
        if let Some(change) = params.content_changes.into_iter().last() {
            self.on_change(uri, &change.text, Some(params.text_document.version))
                .await;
        }
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        self.documents.remove(&params.text_document.uri);
    }

    async fn hover(&self, params: HoverParams) -> Result<Option<Hover>> {
        let uri = &params.text_document_position_params.text_document.uri;
        let pos = params.text_document_position_params.position;

        let doc = match self.documents.get(uri) {
            Some(d) => d.clone(),
            None => return Ok(None),
        };

        let text = doc.rope.to_string();
        let cursor = position_to_byte(&doc.rope, pos);
        let line_idx = doc.rope.byte_to_line(cursor);
        let line_start = doc.rope.line_to_byte(line_idx);
        let line_text = doc.rope.line(line_idx).to_string();

        // Check if cursor is on an SVar reference
        if let Some(svar_name) = self.svar_ref_at_position(&line_text, cursor - line_start) {
            if let Some(info) = doc.svars.get(svar_name) {
                let value = text
                    .get(info.value_start as usize..info.value_end as usize)
                    .unwrap_or("");
                let hover_text = format!("**SVar** `{svar_name}`\n\n```\n{value}\n```");
                return Ok(Some(Hover {
                    contents: HoverContents::Markup(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: hover_text,
                    }),
                    range: None,
                }));
            } else {
                return Ok(Some(Hover {
                    contents: HoverContents::Markup(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: format!("**SVar** `{svar_name}` — ⚠️ not defined on this card"),
                    }),
                    range: None,
                }));
            }
        }

        // Check if cursor is on a param key — show semantic type
        let parsed = ParsedCardScript::parse(&text);
        for line in parsed.lines() {
            if line.line_no != line_idx + 1 {
                continue;
            }
            match &line.kind {
                ScriptLineKind::Ability(ability) => {
                    for entry in ability.params.entries() {
                        if cursor >= entry.key_span.start && cursor <= entry.value_span.end {
                            let sem = entry.semantic();
                            return Ok(Some(Hover {
                                contents: HoverContents::Markup(MarkupContent {
                                    kind: MarkupKind::Markdown,
                                    value: format!(
                                        "**{}** → `{:?}`\n\nRaw: `{}`",
                                        sem.key,
                                        sem.value.kind(),
                                        sem.raw_value
                                    ),
                                }),
                                range: None,
                            }));
                        }
                    }
                }
                ScriptLineKind::Trigger(rec)
                | ScriptLineKind::StaticAbility(rec)
                | ScriptLineKind::Replacement(rec) => {
                    for entry in rec.params.entries() {
                        if cursor >= entry.key_span.start && cursor <= entry.value_span.end {
                            let sem = entry.semantic();
                            return Ok(Some(Hover {
                                contents: HoverContents::Markup(MarkupContent {
                                    kind: MarkupKind::Markdown,
                                    value: format!(
                                        "**{}** → `{:?}`\n\nRaw: `{}`",
                                        sem.key,
                                        sem.value.kind(),
                                        sem.raw_value
                                    ),
                                }),
                                range: None,
                            }));
                        }
                    }
                }
                _ => {}
            }
        }

        Ok(None)
    }

    async fn goto_definition(
        &self,
        params: GotoDefinitionParams,
    ) -> Result<Option<GotoDefinitionResponse>> {
        let uri = &params.text_document_position_params.text_document.uri;
        let pos = params.text_document_position_params.position;

        let doc = match self.documents.get(uri) {
            Some(d) => d.clone(),
            None => return Ok(None),
        };

        let cursor = position_to_byte(&doc.rope, pos);
        let line_idx = doc.rope.byte_to_line(cursor);
        let line_start = doc.rope.line_to_byte(line_idx);
        let line_text = doc.rope.line(line_idx).to_string();

        if let Some(svar_name) = self.svar_ref_at_position(&line_text, cursor - line_start) {
            if let Some(info) = doc.svars.get(svar_name) {
                return Ok(Some(GotoDefinitionResponse::Scalar(Location {
                    uri: uri.clone(),
                    range: Range {
                        start: byte_to_position(&doc.rope, info.name_start as usize),
                        end: byte_to_position(&doc.rope, info.name_end as usize),
                    },
                })));
            }
        }

        Ok(None)
    }
}

// ── main ────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();

    let (service, socket) = LspService::new(Backend::new);
    Server::new(stdin, stdout, socket).serve(service).await;
}
