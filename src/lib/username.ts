const NAME_TAG_RE = /@\d{4}$/;

export function stripUsernameTag(username: string): string {
  return username.replace(NAME_TAG_RE, "");
}

export function suffixUsername(username: string): string {
  const tag = Math.floor(1000 + Math.random() * 9000);
  return `${stripUsernameTag(username)}@${tag}`;
}
