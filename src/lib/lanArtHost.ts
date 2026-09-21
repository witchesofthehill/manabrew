/**
 * Where this machine reads card art somebody else downloaded, cleared when the
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

export function setRelayArtBase(url: string | null): void {
  advertised = url ? url.replace(/\/+$/, "") : null;
}

export function setLanArtHost(address: string | null, port?: number | null): void {
  discovered = address && port ? `http://${address}:${port}` : null;
}

export function lanArtUrl(key: string): string | null {
  const base = advertised ?? discovered;
  return base ? `${base}/scryfall-img/${key}` : null;
}
