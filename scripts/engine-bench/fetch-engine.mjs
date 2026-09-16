#!/usr/bin/env node
/**
 * Assembles an `--engine` directory from a deployed site, so a bench or A/B
 * can run the engine players have without a Web Image toolchain or an npm
 * release. The site's bundle names the three content-hashed engine assets;
 * the launcher and wasm come from there, the facade (worker, seat, Node entry)
 * from this checkout's `packages/forge-wasm`.
 *
 *   node scripts/engine-bench/fetch-engine.mjs --into target/engines/prod
 *   node scripts/engine-bench/fetch-engine.mjs --from https://staging.manabrew.app --into target/engines/staging
 *   node scripts/engine-bench/stress.mjs --engines prod=target/engines/prod,pr=packages/forge-wasm ...
 */
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const from = option("from", "https://play.manabrew.app").replace(/\/$/, "");
const into = resolve(option("into", join(root, "target", "engines", new URL(from).hostname)));

const text = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
};

const index = await text(`${from}/`);
const entry = index.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
if (!entry) throw new Error(`${from}: no index bundle in the page`);
const bundle = await text(`${from}${entry}`);
const launcher = bundle.match(/\/assets\/forgeharness-[A-Za-z0-9_-]+\.js/)?.[0];
const wasm = bundle.match(/\/assets\/forgeharness\.js-[A-Za-z0-9_-]+\.wasm/)?.[0];
if (!launcher || !wasm) throw new Error(`${entry}: engine assets not named in the bundle`);

mkdirSync(into, { recursive: true });
const facade = join(root, "packages", "forge-wasm");
for (const file of readdirSync(facade)) {
  if (/^forgeharness\.js(\.wasm)?$/.test(file)) continue;
  copyFileSync(join(facade, file), join(into, file));
}
for (const [asset, name] of [
  [launcher, "forgeharness.js"],
  [wasm, "forgeharness.js.wasm"],
]) {
  const res = await fetch(`${from}${asset}`);
  if (!res.ok) throw new Error(`${asset}: ${res.status}`);
  writeFileSync(join(into, name), Buffer.from(await res.arrayBuffer()));
  console.log(`${asset} -> ${name}`);
}
writeFileSync(
  join(into, "stamp.js"),
  `export const VERSION = "${new URL(from).hostname} ${new Date().toISOString().slice(0, 10)}";\n` +
    `export const CARDSET_ARCHIVE_VERSION = "unknown";\n` +
    `export const BUILD_COMMIT = "${launcher.slice(-11, -3)}";\n`,
);
console.log(into);
