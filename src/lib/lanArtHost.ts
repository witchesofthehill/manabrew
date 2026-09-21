/**
 * Where this machine reads card art somebody else downloaded: set when joining a
 * LAN room whose host advertises an art port (the `art` mDNS property, carried
 * as `LanTarget.artPort`), cleared when leaving.
 *
 * Desktop only. The listener is plain http, which an https page cannot fetch.
 */
let host: string | null = null;

export function setLanArtHost(address: string | null, port?: number | null): void {
  host = address && port ? `http://${address}:${port}` : null;
}

export function lanArtUrl(key: string): string | null {
  return host ? `${host}/scryfall-img/${key}` : null;
}
