use super::paper_card::PaperCard;
use super::sealed_template::SealedTemplate;

pub trait SealedProduct {
    fn name(&self) -> &str;
    fn template(&self) -> &SealedTemplate;
    fn total_cards(&self) -> u32 {
        self.template().number_of_cards_expected()
    }
    fn generate(&mut self) -> Vec<PaperCard>;
}
