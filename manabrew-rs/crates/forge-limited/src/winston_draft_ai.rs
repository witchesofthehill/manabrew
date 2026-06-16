use rand::rngs::StdRng;
use rand::Rng;
use rand::SeedableRng;

pub struct WinstonDraftAI {
    rng: StdRng,
}

impl Default for WinstonDraftAI {
    fn default() -> Self {
        Self::new()
    }
}

impl WinstonDraftAI {
    pub fn new() -> Self {
        Self {
            rng: StdRng::from_entropy(),
        }
    }

    pub fn roll_take(&mut self, pile_size: i32) -> bool {
        let value = pile_size * 10;
        self.rng.gen_range(0..100) < value
    }
}
