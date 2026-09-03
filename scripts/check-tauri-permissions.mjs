/**
 * Every command in `generate_handler!` must also be listed in the permission
 * manifest, or `invoke` is denied at the boundary on every origin.
 *
 * The manifest says "keep in sync" in prose, which is how three commands
 * shipped without it: `forge_host_signal`, `forge_host_serving` and
 * `forge_host_seat_envelope`. Tauri denied all three, `invoke` rejected, the
 * caller caught the rejection into `console.warn`, and a release build has no
 * console to print it to. The desktop host looked like it simply never offered.
 *
 * A denial cannot be made loud from here, so the sync is checked instead.
 */
import { readFileSync } from "node:fs";

const LIB = "src-tauri/src/lib.rs";
const MANIFEST = "src-tauri/permissions/app-commands.toml";

const lib = readFileSync(LIB, "utf8");
const manifest = readFileSync(MANIFEST, "utf8");

// The handler list is `generate_handler![ ... ]`, one `module::command` or
// `command` per line, comments and cfg attributes interleaved.
const handlerBlock = lib.match(/generate_handler!\s*\[([\s\S]*?)\]\s*\)/);
if (!handlerBlock) {
  console.error(`could not find generate_handler! in ${LIB}`);
  process.exit(2);
}

const handlers = new Set(
  handlerBlock[1]
    .split("\n")
    .map((line) =>
      line
        .replace(/\/\/.*$/, "")
        .trim()
        .replace(/,$/, ""),
    )
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("/*"))
    // `forge_room::start_forge_host` is exposed to the webview as
    // `start_forge_host`; the module path is not part of the command name.
    .map((path) => path.split("::").pop()),
);

const allowBlock = manifest.match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/);
if (!allowBlock) {
  console.error(`could not find commands.allow in ${MANIFEST}`);
  process.exit(2);
}
const allowed = new Set([...allowBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));

const missing = [...handlers].filter((c) => !allowed.has(c)).sort();
const stale = [...allowed].filter((c) => !handlers.has(c)).sort();

if (missing.length) {
  console.error(
    `${missing.length} command(s) in generate_handler! are missing from ${MANIFEST}.\n` +
      `Tauri denies these on every origin, and the rejection surfaces only as a\n` +
      `console warning the release build cannot show:\n` +
      missing.map((c) => `  ${c}`).join("\n"),
  );
}
if (stale.length) {
  console.error(
    `\n${stale.length} entr(y/ies) in ${MANIFEST} name no command in generate_handler!:\n` +
      stale.map((c) => `  ${c}`).join("\n"),
  );
}
if (missing.length || stale.length) process.exit(1);

console.log(`tauri commands and permissions agree (${handlers.size} commands)`);
