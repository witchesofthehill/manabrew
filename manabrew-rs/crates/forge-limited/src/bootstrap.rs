use forge_foundation::edition::{EditionEntry, EditionsRegistry};
use forge_foundation::sealed_product::{booster_template_registry, PaperCard};
const BOOSTER_TEMPLATES_FILE: &str = "boosters-special";

#[derive(Debug, Default)]
pub struct BootstrapReport {
    pub editions_loaded: usize,
    pub editions_failed: usize,
    pub booster_templates_loaded: bool,
}

pub fn build_registry<'a, F>(
    editions: impl IntoIterator<Item = (&'a str, &'a str)>,
    block_data: impl IntoIterator<Item = (&'a str, &'a str)>,
    paper_card_for: F,
) -> (EditionsRegistry, BootstrapReport)
where
    F: Fn(&str, &EditionEntry) -> PaperCard,
{
    let mut registry = EditionsRegistry::new();
    let mut report = BootstrapReport::default();

    for (_name, raw) in editions {
        let code = registry.ingest_file(raw);
        if code.is_empty() {
            report.editions_failed += 1;
        } else {
            report.editions_loaded += 1;
        }
    }

    registry.install_print_sheets(paper_card_for);

    for (name, raw) in block_data {
        if name == BOOSTER_TEMPLATES_FILE {
            booster_template_registry::install(booster_template_registry::parse_boosters_special(
                raw,
            ));
            report.booster_templates_loaded = true;
            break;
        }
    }

    (registry, report)
}
