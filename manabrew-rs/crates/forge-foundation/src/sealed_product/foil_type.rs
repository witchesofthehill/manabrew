use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum FoilType {
    #[default]
    NotSupported,
    OldStyle,
    Modern,
}

impl FoilType {
    pub fn supports_foil(&self) -> bool {
        !matches!(self, FoilType::NotSupported)
    }
}
