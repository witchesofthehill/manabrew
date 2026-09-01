// Stamped at build time from package.json and the tree. A checkout that has
// not been through that build reads as dev.
export const VERSION = "0.0.0-dev";

/**
 * The `forge-cardset-archive` release carrying the same selector, installable
 * with `cargo add`. It is the last *released* version, so a package built
 * between crate releases holds source the crate has not shipped: BUILD_COMMIT
 * is the exact answer.
 */
export const CARDSET_ARCHIVE_VERSION = "0.0.0-dev";
export const BUILD_COMMIT = "unknown";
