use std::path::PathBuf;
use std::{collections::BTreeMap, fs::File};

use forge_carddb::{CardDatabase, CardFace};
use manabrew_engine::parsing::{
    parse_semantic_param_value, CompiledSelector, Params, SemanticParamValue,
};
use memmap2::Mmap;

fn main() {
    let archive_path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../src-tauri/resources/cardset.rkyv")
        });
    let file = File::open(&archive_path)
        .unwrap_or_else(|e| panic!("open {}: {e}", archive_path.display()));
    let mmap = unsafe { Mmap::map(&file).expect("mmap") };
    let bundle = CardDatabase::load_from_archive(&mmap).expect("load archive");
    let db = bundle.cards;
    println!(
        "loaded={} failed={} archive={}",
        bundle.cards_result.loaded,
        bundle.cards_result.failed,
        archive_path.display()
    );

    let mut raw_predicates = BTreeMap::<String, usize>::new();
    let mut valid_non_selectors = BTreeMap::<String, BTreeMap<String, usize>>::new();

    // Tool scans every face — force the lazy DB to materialize all cards.
    db.force_parse_all();
    for (_key, rules) in db.iter() {
        scan_face(
            &rules.main_part,
            &mut raw_predicates,
            &mut valid_non_selectors,
        );
        if let Some(face) = &rules.other_part {
            scan_face(face, &mut raw_predicates, &mut valid_non_selectors);
        }
        for face in rules.specialized_parts.values() {
            scan_face(face, &mut raw_predicates, &mut valid_non_selectors);
        }
    }

    println!("\nraw selector predicates:");
    let mut raw_predicates = raw_predicates.into_iter().collect::<Vec<_>>();
    raw_predicates.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    for (raw, count) in raw_predicates.iter().take(80) {
        println!("{count:6} {raw}");
    }

    println!("\nValid* params that are not selector/reference classified:");
    let mut valid_non_selectors = valid_non_selectors.into_iter().collect::<Vec<_>>();
    valid_non_selectors.sort_by(|a, b| {
        let a_total = a.1.values().sum::<usize>();
        let b_total = b.1.values().sum::<usize>();
        b_total.cmp(&a_total).then_with(|| a.0.cmp(&b.0))
    });
    for (key, values) in valid_non_selectors {
        let total = values.values().sum::<usize>();
        println!("{total:6} {key}");
        let mut values = values.into_iter().collect::<Vec<_>>();
        values.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        for (kind, count) in values.iter().take(12) {
            println!("       {count:6} {kind}");
        }
    }
}

fn scan_face(
    face: &CardFace,
    raw_predicates: &mut BTreeMap<String, usize>,
    valid_non_selectors: &mut BTreeMap<String, BTreeMap<String, usize>>,
) {
    for line in face
        .abilities
        .iter()
        .chain(&face.static_abilities)
        .chain(&face.triggers)
        .chain(&face.replacements)
        .chain(face.svars.values())
    {
        scan_params(line, raw_predicates, valid_non_selectors);
    }
}

fn scan_params(
    raw: &str,
    raw_predicates: &mut BTreeMap<String, usize>,
    valid_non_selectors: &mut BTreeMap<String, BTreeMap<String, usize>>,
) {
    let params = Params::from_raw(raw);
    for (key, value) in params.iter() {
        match parse_semantic_param_value(key, value) {
            SemanticParamValue::Selector(_) | SemanticParamValue::Reference(_) => {
                let selector = CompiledSelector::parse(value);
                for raw in selector.raw_predicates() {
                    if !raw.is_empty() {
                        *raw_predicates.entry(raw.to_string()).or_default() += 1;
                    }
                }
            }
            semantic if key.starts_with("Valid") => {
                let kind = format!("{:?}", semantic.kind());
                *valid_non_selectors
                    .entry(key.to_string())
                    .or_default()
                    .entry(kind)
                    .or_default() += 1;
            }
            _ => {}
        }
    }
}
