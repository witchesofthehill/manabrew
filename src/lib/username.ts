const NAME_TAG_RE = /@\d{4}$/;

export function stripUsernameTag(username: string): string {
  return username.replace(NAME_TAG_RE, "");
}

export function hasUsernameTag(username: string): boolean {
  return NAME_TAG_RE.test(username);
}

export function ensureUsernameTag(username: string, previous?: string): string {
  const base = stripUsernameTag(username.trim());
  if (!base) return base;
  const tag = previous?.match(NAME_TAG_RE)?.[0] ?? `@${Math.floor(1000 + Math.random() * 9000)}`;
  return `${base}${tag}`;
}
