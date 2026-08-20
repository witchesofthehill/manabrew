//! What the client on the far end of a session can be trusted to understand.
//!
//! The relay learns two things at `Authenticate` time: the platform the client
//! runs on, and the app version it was built from. Platform is for analytics.
//! Version is load-bearing: it decides which wire features the relay may use
//! against that seat, because installed desktop builds lag the server by
//! however long it takes the player to relaunch the app.

use crate::protocol::ClientPlatform;

/// Cap on the version string a client may report. Anything can open a socket
/// and send anything, and this string reaches the analytics log.
const MAX_VERSION_CHARS: usize = 32;

/// First release whose client can apply a `stateDelta` envelope. The applier is
/// `src/lib/stateDelta.ts`, wired into `platform/web.ts`; before it, that switch
/// had no default arm, so a patch was silently dropped and the board stopped
/// updating for the rest of the game.
const MIN_STATE_PATCH_VERSION: Version = Version(3, 17, 0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Version(u32, u32, u32);

impl Version {
    /// Parses `X.Y.Z`, ignoring any pre-release or build suffix. Anything that
    /// does not fit is not a version we know how to reason about.
    fn parse(raw: &str) -> Option<Self> {
        let core = raw.split(['-', '+']).next()?;
        let mut parts = core.split('.');
        let mut next = || parts.next()?.parse::<u32>().ok();
        let version = Self(next()?, next()?, next()?);
        parts.next().is_none().then_some(version)
    }
}

/// The client identity carried on a session, as reported by the client itself.
#[derive(Debug, Clone, Default)]
pub struct ClientBuild {
    pub platform: ClientPlatform,
    version: Option<Version>,
    raw_version: Option<String>,
}

impl ClientBuild {
    pub fn new(platform: ClientPlatform, raw_version: Option<String>) -> Self {
        let raw_version = raw_version.map(|raw| {
            if raw.chars().count() > MAX_VERSION_CHARS {
                raw.chars().take(MAX_VERSION_CHARS).collect()
            } else {
                raw
            }
        });
        Self {
            platform,
            version: raw_version.as_deref().and_then(Version::parse),
            raw_version,
        }
    }

    /// What goes in the analytics event. `None` for a client that reported
    /// nothing, which is itself the signal: it predates version reporting.
    pub fn version(&self) -> Option<&str> {
        self.raw_version.as_deref()
    }

    /// Whether this seat can apply `stateDelta` patches. Unreported and
    /// unparseable versions answer no, so an unknown client gets full states.
    pub fn applies_state_patches(&self) -> bool {
        self.version
            .is_some_and(|version| version >= MIN_STATE_PATCH_VERSION)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(version: &str) -> ClientBuild {
        ClientBuild::new(ClientPlatform::Desktop, Some(version.to_string()))
    }

    #[test]
    fn parses_plain_releases() {
        assert_eq!(Version::parse("3.17.0"), Some(Version(3, 17, 0)));
        assert_eq!(Version::parse("3.17.3-rc.1"), Some(Version(3, 17, 3)));
        assert_eq!(Version::parse("3.17.3+build.9"), Some(Version(3, 17, 3)));
    }

    #[test]
    fn rejects_anything_else() {
        for raw in ["3.17", "3.17.0.1", "v3.17.0", "", "latest", "3.x.0"] {
            assert_eq!(Version::parse(raw), None, "{raw}");
        }
    }

    #[test]
    fn orders_by_component_not_lexically() {
        assert!(Version(3, 9, 6) < Version(3, 17, 0));
        assert!(Version(3, 17, 0) < Version(3, 17, 3));
        assert!(Version(4, 0, 0) > Version(3, 17, 3));
    }

    #[test]
    fn state_patches_need_the_applier_release() {
        assert!(!build("3.16.0").applies_state_patches());
        assert!(!build("3.9.6").applies_state_patches());
        assert!(build("3.17.0").applies_state_patches());
        assert!(build("3.17.3").applies_state_patches());
        assert!(build("4.0.0").applies_state_patches());
    }

    #[test]
    fn unknown_clients_get_full_states() {
        assert!(!ClientBuild::default().applies_state_patches());
        assert!(!build("who knows").applies_state_patches());
        assert!(!ClientBuild::new(ClientPlatform::Web, None).applies_state_patches());
    }

    #[test]
    fn caps_the_reported_string() {
        let build = ClientBuild::new(ClientPlatform::Web, Some("9".repeat(500)));
        assert_eq!(build.version().map(str::len), Some(MAX_VERSION_CHARS));
        assert!(!build.applies_state_patches());
    }
}
