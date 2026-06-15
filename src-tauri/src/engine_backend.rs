pub mod java_backend;
pub mod rust_backend;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineBackendKind {
    Manabrew,
    Forge,
}

impl EngineBackendKind {
    pub fn from_env() -> Self {
        std::env::var("MANA_BREW_ENGINE_BACKEND")
            .ok()
            .and_then(|value| Self::parse(&value))
            .unwrap_or(Self::Manabrew)
    }

    fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "manabrew" => Some(Self::Manabrew),
            "forge" => Some(Self::Forge),
            _ => None,
        }
    }

    pub fn is_supported(self) -> bool {
        match self {
            Self::Manabrew => true,
            Self::Forge => cfg!(feature = "java-forge"),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Manabrew => "manabrew",
            Self::Forge => "forge",
        }
    }
}
