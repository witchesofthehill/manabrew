use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};

use serde::Deserialize;

const DIM: usize = 1 << 18;

#[derive(Deserialize)]
struct Row {
    seed: u64,
    step: Option<String>,
    label: usize,
    bot: Option<usize>,
    cands: Vec<Vec<u32>>,
}

fn arg(name: &str, fallback: &str) -> String {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
        .unwrap_or_else(|| fallback.to_string())
}

fn scores(w: &[f32], row: &Row) -> Vec<f32> {
    row.cands
        .iter()
        .map(|c| c.iter().map(|&i| w[i as usize & (DIM - 1)]).sum())
        .collect()
}

fn argmax(s: &[f32]) -> usize {
    s.iter()
        .enumerate()
        .fold(0, |best, (i, v)| if *v > s[best] { i } else { best })
}

fn agreement(w: &[f32], rows: &[&Row]) -> f32 {
    let hits = rows
        .iter()
        .filter(|r| argmax(&scores(w, r)) == r.label)
        .count();
    hits as f32 / rows.len().max(1) as f32
}

fn main() {
    let input = arg("--in", "decisions.jsonl");
    let output = arg("--out", "manabot-model.json");
    let epochs: usize = arg("--epochs", "8").parse().unwrap();
    let lr: f32 = arg("--lr", "0.2").parse().unwrap();
    let l2: f32 = arg("--l2", "1e-6").parse().unwrap();
    let holdout: u64 = arg("--holdout", "5").parse().unwrap();

    let rows: Vec<Row> = BufReader::new(fs::File::open(&input).expect("open input"))
        .lines()
        .map_while(Result::ok)
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(&l).expect("row"))
        .filter(|r: &Row| r.cands.len() > 1)
        .collect();
    let (test, train): (Vec<&Row>, Vec<&Row>) = rows
        .iter()
        .partition(|r| holdout > 0 && r.seed % holdout == 0);
    println!("rows: train {} test {}", train.len(), test.len());

    let bot_agree = |rows: &[&Row]| {
        let with = rows.iter().filter(|r| r.bot.is_some()).count();
        let hit = rows.iter().filter(|r| r.bot == Some(r.label)).count();
        hit as f32 / with.max(1) as f32
    };
    println!(
        "rule bot agreement: train {:.3} test {:.3}",
        bot_agree(&train),
        bot_agree(&test)
    );

    let mut w = vec![0.0f32; DIM];
    let mut g2 = vec![0.0f32; DIM];
    let mut order: Vec<usize> = (0..train.len()).collect();
    let mut rng = train.len() as u64 * 2654435761 + 1;
    for epoch in 0..epochs {
        for i in (1..order.len()).rev() {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            order.swap(i, (rng % (i as u64 + 1)) as usize);
        }
        let mut loss = 0.0f64;
        for &idx in &order {
            let row = train[idx];
            let s = scores(&w, row);
            let max = s.iter().cloned().fold(f32::MIN, f32::max);
            let exp: Vec<f32> = s.iter().map(|v| (v - max).exp()).collect();
            let z: f32 = exp.iter().sum();
            loss -= (exp[row.label] / z).ln() as f64;
            for (k, cand) in row.cands.iter().enumerate() {
                let grad = exp[k] / z - if k == row.label { 1.0 } else { 0.0 };
                if grad.abs() < 1e-6 {
                    continue;
                }
                for &f in cand {
                    let i = f as usize & (DIM - 1);
                    let g = grad + l2 * w[i];
                    g2[i] += g * g;
                    w[i] -= lr * g / (g2[i].sqrt() + 1e-6);
                }
            }
        }
        println!(
            "epoch {epoch}: loss {:.4} train {:.3} test {:.3}",
            loss / train.len() as f64,
            agreement(&w, &train),
            agreement(&w, &test)
        );
    }

    let mut by_step: HashMap<String, (usize, usize)> = HashMap::new();
    for r in &test {
        let e = by_step
            .entry(r.step.clone().unwrap_or_default())
            .or_default();
        e.1 += 1;
        if argmax(&scores(&w, r)) == r.label {
            e.0 += 1;
        }
    }
    let mut steps: Vec<_> = by_step.into_iter().collect();
    steps.sort_by_key(|(_, (_, n))| std::cmp::Reverse(*n));
    for (step, (hit, n)) in steps {
        println!(
            "  test {step:<24} {hit:>5}/{n:<5} {:.3}",
            hit as f32 / n as f32
        );
    }

    let sparse: Vec<(u32, f32)> = w
        .iter()
        .enumerate()
        .filter(|(_, v)| **v != 0.0)
        .map(|(i, v)| (i as u32, *v))
        .collect();
    let mut out = fs::File::create(&output).expect("create output");
    out.write_all(
        serde_json::to_string(&serde_json::json!({ "dim": DIM, "weights": sparse }))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    println!("wrote {} nonzero weights to {output}", sparse.len());
}
