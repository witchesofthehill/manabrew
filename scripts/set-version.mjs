import { readFileSync, writeFileSync } from "node:fs";

const v = process.argv[2];
if (!v) {
  console.error("usage: set-version <version>");
  process.exit(1);
}

const sub = (f, re, rep) => writeFileSync(f, readFileSync(f, "utf8").replace(re, rep));

sub("package.json", /"version": "[^"]*"/, `"version": "${v}"`);
sub("src-tauri/tauri.conf.json", /"version": "[^"]*"/, `"version": "${v}"`);
sub("src-tauri/Cargo.toml", /^version = "[^"]*"/m, `version = "${v}"`);
sub("Cargo.lock", /(\[\[package\]\]\nname = "manabrew"\nversion = )"[^"]*"/, `$1"${v}"`);
