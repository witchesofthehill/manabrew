import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { promisify } from "node:util";
import upstream from "../packages/mse-renderer/lib/mse/upstream.mjs";
import { readFontMetadata } from "../packages/mse-renderer/lib/mse/font-metadata.mjs";
import { mseResourceFontPaths } from "../packages/mse-renderer/lib/mse/font-resources.mjs";

const exec = promisify(execFile);
const repository = `https://github.com/${upstream.repository}.git`;
const source = `https://raw.githubusercontent.com/${upstream.repository}/${upstream.revision}/`;
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check"))
  throw new Error("Usage: yarn mse:corpus-index [--check]");
const check = args.includes("--check");
const indexUrl = new URL("../packages/mse-renderer/corpus-index.json", import.meta.url);
const metadataUrl = new URL("../packages/mse-renderer/upstream.json", import.meta.url);
const scratch = await mkdtemp(join(tmpdir(), "manabrew-mse-index-"));

try {
  await exec("git", ["init", "--bare", scratch]);
  await exec(
    "git",
    ["-C", scratch, "fetch", "--filter=blob:none", "--depth=1", repository, upstream.revision],
    { timeout: 120_000 },
  );
  const { stdout } = await exec("git", ["-C", scratch, "ls-tree", "-rz", upstream.revision], {
    maxBuffer: 32 * 1024 * 1024,
  });
  const entries = stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [, type, sha] = entry.slice(0, tab).split(" ");
      return { type, sha, path: entry.slice(tab + 1) };
    })
    .filter((entry) => entry.type === "blob");
  const files = entries.map((entry) => entry.path);
  const fontPaths = mseResourceFontPaths(files);
  const hashes = new Map(entries.map((entry) => [entry.path, entry.sha]));
  const fonts = new Array(fontPaths.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < fontPaths.length) {
        const index = cursor++;
        const path = fontPaths[index];
        const response = await fetch(
          new URL(path.split("/").map(encodeURIComponent).join("/"), source),
          { redirect: "error", signal: AbortSignal.timeout(30_000) },
        );
        if (!response.ok)
          throw new Error(`Font metadata request failed: ${response.status} ${path}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const hash = createHash("sha1")
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest("hex");
        if (hash !== hashes.get(path)) throw new Error(`Font source hash mismatch: ${path}`);
        const metadata = readFontMetadata(bytes);
        fonts[index] = {
          path,
          names: [
            ...new Set(
              [...metadata.families, metadata.fullName, metadata.postscriptName].filter(Boolean),
            ),
          ],
        };
      }
    }),
  );
  const index = { revision: upstream.revision, files, fonts };
  const indexPath = fileURLToPath(indexUrl);
  const serialized = await format(JSON.stringify(index), {
    ...(await resolveConfig(indexPath)),
    filepath: indexPath,
  });
  const metadata = JSON.parse(await readFile(metadataUrl, "utf8"));
  const indexSha256 = createHash("sha256").update(serialized).digest("hex");
  if (metadata.corpus.revision !== upstream.revision)
    throw new Error("Corpus revision differs between upstream.json and lib/mse/upstream.mjs");
  if (check) {
    const committed = JSON.parse(await readFile(indexUrl, "utf8"));
    if (
      serialized !== (await readFile(indexUrl, "utf8")) ||
      metadata.corpus.indexSha256 !== indexSha256
    ) {
      throw new Error(
        `Committed corpus metadata differs from pinned upstream: ${JSON.stringify({
          filesMatch: JSON.stringify(committed.files) === JSON.stringify(files),
          firstChangedFont: fonts.find(
            (font, index) => JSON.stringify(font) !== JSON.stringify(committed.fonts[index]),
          ),
          committedFontCount: committed.fonts.length,
          reproducedFontCount: fonts.length,
          indexSha256,
        })}`,
      );
    }
  } else {
    metadata.corpus.indexSha256 = indexSha256;
    await writeFile(indexUrl, serialized);
    await writeFile(metadataUrl, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  console.log(
    JSON.stringify({ revision: upstream.revision, files: files.length, fonts: fonts.length }),
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
