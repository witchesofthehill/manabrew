import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pins from "../packages/mse-renderer/lib/mse/upstream.mjs";
import {
  resolveCorpusUrl,
  validateCorpusManifest,
} from "../packages/mse-renderer/corpus-source.mjs";

const root = new URL("../packages/mse-renderer/", import.meta.url);
const metadataUrl = new URL("upstream.json", root);
const exec = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const blobHash = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const args = process.argv.slice(2);
const hostIndex = args.indexOf("--host");
const host = hostIndex < 0 ? null : args[hostIndex + 1];
const allowed = new Set(["--upstream", "--record-local", "--host", "--origin"]);
const originIndex = args.indexOf("--origin");
const origin = originIndex < 0 ? null : args[originIndex + 1];
const manifestIndex = args.indexOf("--host-manifest");
const manifestPath = manifestIndex < 0 ? null : args[manifestIndex + 1];
allowed.add("--host-manifest");
const valueIndexes = new Set(
  [hostIndex, originIndex, manifestIndex].filter((index) => index >= 0).map((index) => index + 1),
);
if (
  args.some((arg, index) => !allowed.has(arg) && !valueIndexes.has(index)) ||
  [...valueIndexes].some((index) => !args[index] || args[index].startsWith("--")) ||
  (originIndex >= 0 && !host)
) {
  throw new Error(
    "Usage: yarn mse:verify [--upstream] [--record-local] [--host URL --origin APP_ORIGIN] [--host-manifest OUTPUT]",
  );
}
const online = args.includes("--upstream") || Boolean(host);
const record = args.includes("--record-local");
if (record && online)
  throw new Error("Record reviewed local changes separately from upstream/host verification");

async function fetchBytes(url, appOrigin) {
  let response;
  try {
    response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: appOrigin ? { Origin: appOrigin } : {},
    });
  } catch (error) {
    throw new Error(`Upstream or host unavailable: ${url}`, { cause: error });
  }
  if (!response.ok) throw new Error(`Upstream or host unavailable: HTTP ${response.status} ${url}`);
  if (appOrigin && new URL(url).origin !== appOrigin) {
    const cors = response.headers.get("access-control-allow-origin");
    if (cors !== "*" && cors !== appOrigin)
      throw new Error(`CORS does not permit ${appOrigin}: ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function each(items, action) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await action(items[index]);
      }
    }),
  );
}

async function corpusTree() {
  const scratch = await mkdtemp(join(tmpdir(), "manabrew-mse-verify-"));
  try {
    await exec("git", ["init", "--bare", scratch]);
    await exec(
      "git",
      [
        "-C",
        scratch,
        "fetch",
        "--filter=blob:none",
        "--depth=1",
        `https://github.com/${pins.repository}.git`,
        pins.revision,
      ],
      { timeout: 120_000 },
    );
    const { stdout } = await exec("git", ["-C", scratch, "ls-tree", "-rz", pins.revision], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout
      .split("\0")
      .filter(Boolean)
      .flatMap((entry) => {
        const tab = entry.indexOf("\t");
        const [, type, sha] = entry.slice(0, tab).split(" ");
        return type === "blob" ? [{ type, sha, path: entry.slice(tab + 1) }] : [];
      });
  } catch (error) {
    throw new Error(`Pinned corpus unavailable: ${pins.repository}@${pins.revision}`, {
      cause: error,
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const metadata = JSON.parse(await readFile(metadataUrl, "utf8"));
const corpusBytes = await readFile(new URL("corpus-index.json", root));
const corpus = JSON.parse(corpusBytes);
const modifications = new Map(metadata.localModifications.map((entry) => [entry.file, entry]));
if (modifications.size !== metadata.localModifications.length)
  throw new Error("Duplicate local modification entries");
const destinations = new Set(metadata.files.map((entry) => entry.destination));
if (destinations.size !== metadata.files.length)
  throw new Error("Duplicate vendored source entries");
for (const file of await readdir(new URL("lib/mse/", root))) {
  if (file.endsWith(".mjs") && !destinations.has(`lib/mse/${file}`))
    throw new Error(`Untracked vendored source: ${file}`);
}
for (const [file, modification] of modifications) {
  if (!destinations.has(file) || !modification.change?.trim())
    throw new Error(`Undocumented local patch: ${file}`);
}
for (const entry of metadata.files) {
  if (!/^lib\/mse\/[\w-]+\.mjs$/.test(entry.destination) || !/^[a-f0-9]{64}$/.test(entry.sha256))
    throw new Error(`Invalid source entry: ${entry.destination}`);
  const actual = hash(await readFile(new URL(entry.destination, root)));
  const modification = modifications.get(entry.destination);
  if (modification && record) modification.localSha256 = actual;
  else if (actual !== (modification?.localSha256 ?? entry.sha256))
    throw new Error(
      `Local source drift: ${entry.destination}; review the patch and its description before --record-local`,
    );
}
if (
  corpus.revision !== pins.revision ||
  metadata.corpus.revision !== pins.revision ||
  metadata.corpus.repository !== `https://github.com/${pins.repository}`
)
  throw new Error("Corpus revision/repository mismatch");
if (metadata.corpus.indexSha256 !== hash(corpusBytes))
  throw new Error("Corpus index hash mismatch; review yarn mse:corpus-index output");
for (const reference of [pins.referenceImplementation, pins.legacyReferenceImplementation]) {
  if (
    !metadata.referenceImplementations.some(
      (entry) => entry.repository === reference.repository && entry.revision === reference.revision,
    )
  )
    throw new Error(`Reference pin mismatch: ${reference.repository}`);
}
if (online) {
  const repository = metadata.repository.replace("https://github.com/", "");
  const base = `https://raw.githubusercontent.com/${repository}/${metadata.revision}/`;
  await each(metadata.files, async (entry) => {
    if (hash(await fetchBytes(new URL(entry.source, base))) !== entry.sha256)
      throw new Error(`Pinned upstream hash mismatch: ${entry.source}`);
  });
  const declaration = JSON.parse(
    new TextDecoder().decode(await fetchBytes(new URL(metadata.licenseDeclaration, base))),
  );
  if (declaration.license !== metadata.license)
    throw new Error("Ironsmith license declaration drift");
  await each(metadata.referenceImplementations, async (entry) => {
    const bytes = await fetchBytes(
      `https://raw.githubusercontent.com/${entry.repository}/${entry.revision}/${entry.licenseDeclaration}`,
    );
    if (blobHash(bytes) !== entry.licenseBlobSha1)
      throw new Error(`Reference license drift: ${entry.repository}`);
  });
  const tree = await corpusTree();
  validateCorpusManifest({ sha: pins.revision, truncated: false, tree }, corpus);
  if (host) {
    const baseUrl = resolveCorpusUrl(host);
    if (!origin || new URL(origin).origin !== origin)
      throw new Error(
        "--host requires --origin with the application origin, without a trailing slash",
      );
    const manifest = JSON.parse(
      new TextDecoder().decode(await fetchBytes(new URL("upstream-tree.json", baseUrl), origin)),
    );
    validateCorpusManifest(manifest, corpus);
    const assets = tree.filter(
      (entry) => entry.path.startsWith("data/") || entry.path.startsWith("Magic - Fonts/"),
    );
    await each(assets, async (entry) => {
      const url = new URL(entry.path.split("/").map(encodeURIComponent).join("/"), baseUrl);
      if (blobHash(await fetchBytes(url, origin)) !== entry.sha)
        throw new Error(`Host asset differs from pinned corpus: ${entry.path}`);
    });
    console.error(
      `Verified ${assets.length} raw corpus files and CORS for ${origin}; this does not grant hosting rights or establish visual parity.`,
    );
  }
}
if (record) await writeFile(metadataUrl, `${JSON.stringify(metadata, null, 2)}\n`);
if (manifestPath) {
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      sha: corpus.revision,
      truncated: false,
      tree: corpus.files.map((path) => ({ path, type: "blob" })),
    })}\n`,
  );
}
console.log(
  JSON.stringify({
    rendererRevision: metadata.revision,
    corpusRevision: pins.revision,
    sources: metadata.files.length,
    localPatches: modifications.size,
    upstreamChecked: online,
    hostChecked: host ?? null,
    recordedLocalHashes: record,
  }),
);
