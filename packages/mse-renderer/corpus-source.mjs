import { MseError } from "./lib/mse/document.mjs";

export function resolveCorpusUrl(value, location = globalThis.location?.href) {
  const url = new URL(value, location);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/")
  ) {
    throw new MseError(
      "invalid-base-url",
      "MSE corpus URL requires HTTPS, a trailing slash and no credentials, query or fragment; HTTP is allowed only on loopback",
    );
  }
  return url;
}

export function validateCorpusManifest(manifest, corpus) {
  if (
    manifest?.sha !== corpus.revision ||
    manifest.truncated !== false ||
    !Array.isArray(manifest.tree)
  ) {
    throw new MseError(
      "corpus-index",
      "Expected a complete MSE corpus index at the pinned revision",
    );
  }
  const paths = manifest.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const expected = new Set(corpus.files);
  if (
    paths.length !== expected.size ||
    new Set(paths).size !== paths.length ||
    paths.some((path) => !expected.has(path))
  ) {
    throw new MseError(
      "corpus-index",
      "Configured MSE host file inventory differs from the pinned corpus",
    );
  }
  return manifest;
}

export function createCorpusFetcher({ source, pinnedSource, corpus, fetcher }) {
  const treeUrl = new URL("upstream-tree.json", source).href;
  const runtimeUrl = new URL("runtime-index.json", source).href;
  return async (input, init) => {
    const url = String(input);
    if (url === runtimeUrl) {
      return Response.json({ revision: corpus.revision, fonts: corpus.fonts, textPackages: [] });
    }
    if (url === treeUrl && source.href === pinnedSource) {
      return Response.json({
        sha: corpus.revision,
        truncated: false,
        tree: corpus.files.map((path) => ({ path, type: "blob" })),
      });
    }
    const isCorpus = url.startsWith(source.href);
    const response = await fetcher(input, {
      ...init,
      mode: "cors",
      credentials: "omit",
      ...(isCorpus ? { redirect: "error" } : {}),
    });
    if (url !== treeUrl || !response.ok) return response;
    return Response.json(validateCorpusManifest(await response.json(), corpus));
  };
}
