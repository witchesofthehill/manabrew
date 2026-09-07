/** Every command in `generate_handler!` must be in the permission manifest. */
import { readFileSync } from "node:fs";

const LIB = "src-tauri/src/lib.rs";
const MANIFEST = "src-tauri/permissions/app-commands.toml";

const lib = readFileSync(LIB, "utf8");
const manifest = readFileSync(MANIFEST, "utf8");

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
    // The command name is the last path segment.
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
