/**
 * The machine on this network that already downloaded the cards: its art at
 * `/scryfall-img/` and its card records at `/scryfall-card/`. Cleared when the
 * session ends.
 *
 * Two sources, because the two say different things. `AuthResult.art_base_url`
 * is the relay speaking for itself, and behind a proxy it is the only correct
 * answer; the mDNS `art` property is a host and a port this machine discovered,
 * which is all a desktop room ever has. The relay's own answer wins.
 *
 * A discovered host is plain http and so desktop-only, an https page cannot
 * fetch it. An advertised base carries its own scheme and may be either.
 */
let advertised: string | null = null;
let discovered: string | null = null;

export function setRelayCacheBase(url: string | null): void {
  advertised = url ? url.replace(/\/+$/, "") : null;
}

export function setLanCacheHost(address: string | null, port?: number | null): void {
  discovered = address && port ? `http://${address}:${port}` : null;
}

function base(): string | null {
  return advertised ?? discovered;
}

export function lanArtUrl(key: string): string | null {
  const host = base();
  return host ? `${host}/scryfall-img/${key}` : null;
}

/** `path` is the same route this machine serves on itself, so a caller writes
 *  one path and both sources answer it. */
export function lanCacheUrl(path: string): string | null {
  const host = base();
  return host ? `${host}${path}` : null;
}
