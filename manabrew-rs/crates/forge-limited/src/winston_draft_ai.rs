use rand::Rng;
use rand::SeedableRng;
use rand_chacha::ChaCha12Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WinstonDraftAI {
    rng: ChaCha12Rng,
}

impl Default for WinstonDraftAI {
    fn default() -> Self {
        Self::new()
    }
}

impl WinstonDraftAI {
    pub fn new() -> Self {
        Self {
            rng: ChaCha12Rng::from_entropy(),
        }
    }

    pub fn with_rng(rng: ChaCha12Rng) -> Self {
        Self { rng }
    }

    pub fn roll_take(&mut self, pile_size: i32) -> bool {
        let value = pile_size * 10;
        self.rng.gen_range(0..100) < value
    }
}
