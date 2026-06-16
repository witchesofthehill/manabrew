use crate::card_pool::CardPool;
use crate::deck_generator;
use crate::java_random::JavaRandom;
use forge_carddb::CardDatabase;

#[derive(Debug, Clone)]
pub struct Job {
    pub deck1: String,
    pub deck2: String,
    pub seed: u64,
    pub batch_id: i64,
    pub is_fuzz: bool,
}

pub struct Scheduler {
    preset_pairs: Vec<(String, String)>,
    pair_index: usize,
    seed: u64,
    batch_id: i64,
    fuzz_rng: JavaRandom,
    pool: Option<CardPool>,
    fuzz_interval: usize,
    presets_since_fuzz: usize,
}

impl Scheduler {
    pub fn new(
        decks: &[String],
        start_seed: u64,
        fuzz_per_batch: usize,
        db: Option<&CardDatabase>,
        include_self_matchups: bool,
        games_per_matchup: usize,
    ) -> Self {
        let mut preset_pairs = Vec::new();
        let games_per = games_per_matchup.max(1);
        for (i, d1) in decks.iter().enumerate() {
            for (j, d2) in decks.iter().enumerate() {
                if i != j || include_self_matchups {
                    for _ in 0..games_per {
                        preset_pairs.push((d1.clone(), d2.clone()));
                    }
                }
            }
        }

        if preset_pairs.is_empty() {
            preset_pairs.push(("red_burn".into(), "green_stompy".into()));
        }

        let pool = if fuzz_per_batch > 0 {
            db.map(|db| {
                let (pool, _stats) = CardPool::discover(db);
                pool
            })
        } else {
            None
        };

        // Interleave: insert 1 fuzz game every N preset games (capped at 50
        // so fuzz appears quickly even with large deck pools).
        let fuzz_interval = if fuzz_per_batch > 0 && !preset_pairs.is_empty() {
            (preset_pairs.len() / fuzz_per_batch).max(1).min(50)
        } else {
            0
        };

        Self {
            preset_pairs,
            pair_index: 0,
            seed: start_seed,
            batch_id: 1,
            fuzz_rng: JavaRandom::new(start_seed as i64),
            pool,
            fuzz_interval,
            presets_since_fuzz: 0,
        }
    }

    pub fn resume_after(&mut self, deck1: &str, deck2: &str) -> bool {
        if let Some(idx) = self
            .preset_pairs
            .iter()
            .position(|(d1, d2)| d1 == deck1 && d2 == deck2)
        {
            self.pair_index = (idx + 1) % self.preset_pairs.len();
            true
        } else {
            false
        }
    }

    pub fn next_job(&mut self) -> Job {
        if self.fuzz_interval > 0
            && self.pool.is_some()
            && self.presets_since_fuzz >= self.fuzz_interval
        {
            self.presets_since_fuzz = 0;
            return self.next_fuzz_job();
        }

        let (d1, d2) = self.preset_pairs[self.pair_index].clone();
        let job = Job {
            deck1: d1,
            deck2: d2,
            seed: self.seed,
            batch_id: self.batch_id,
            is_fuzz: false,
        };

        self.seed += 1;
        self.pair_index += 1;
        self.presets_since_fuzz += 1;

        if self.pair_index >= self.preset_pairs.len() {
            self.pair_index = 0;
            self.batch_id += 1;
        }

        job
    }

    fn next_fuzz_job(&mut self) -> Job {
        let pool = self.pool.as_ref().expect("fuzz pool must exist");
        let deck1 = deck_generator::generate_deck(&mut self.fuzz_rng, pool);
        let deck2 = deck_generator::generate_deck(&mut self.fuzz_rng, pool);

        let deck1_spec = format_inline_deck(&deck1);
        let deck2_spec = format_inline_deck(&deck2);

        let job = Job {
            deck1: format!("inline:{deck1_spec}"),
            deck2: format!("inline:{deck2_spec}"),
            seed: self.seed,
            batch_id: self.batch_id,
            is_fuzz: true,
        };

        self.seed += 1;
        job
    }

    pub fn preset_pairs_count(&self) -> usize {
        self.preset_pairs.len()
    }

    pub fn current_batch(&self) -> i64 {
        self.batch_id
    }
}

fn format_inline_deck(deck: &[(String, usize)]) -> String {
    deck.iter()
        .map(|(name, count)| format!("{}*{}", name, count))
        .collect::<Vec<_>>()
        .join("|")
}
