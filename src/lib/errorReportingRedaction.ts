const REDACTED = "[redacted]";
const REDACTED_FIELD = `"${REDACTED}"`;
const MAX_INPUT_LENGTH = 16384;
const MAX_MESSAGE_LENGTH = 2048;
const SENSITIVE_KEY = [
  String.raw`pass(?:word|wd|phrase)?(?:[_ -]?hash)?|pwd|secret|credentials?|authorization(?:[_ -]?(?:header|code))?|auth|bearer|cookie|set-cookie|pin|otp|(?:verification|security)[_ -]?code`,
  String.raw`(?:api|private|client|secret|signing|encryption)[_ -]?key|(?:aws[_ -]?)?(?:secret[_ -]?)?access[_ -]?key(?:[_ -]?id)?|client[_ -]?secret`,
  String.raw`(?:aws[_ -]?)?(?:access|refresh|id|session|auth|api|csrf|xsrf)[_ -]?token|token`,
  String.raw`e-?mail(?:[_ -]?address)?|(?:first|last|full|display|contact|given|family|preferred)[_ -]?name|nickname|name|user(?:[_ -]?(?:name|id|agent))?|player|handle`,
  String.raw`account(?:[_ -]?id)?|(?:session|device|game|room|deck|card)[_ -]?id|id|sid`,
  String.raw`(?:ip|street|postal|billing|shipping|home)[_ -]?address|address|phone|telephone|mobile|ssn|social[_ -]?security(?:[_ -]?number)?|date[_ -]?of[_ -]?birth|dob`,
  String.raw`input|payload|request[_ -]?body|response[_ -]?body|chat|journal|deck|hand|cards`,
].join("|");
const SENSITIVE_FIELD = new RegExp(
  String.raw`(\b(?:${SENSITIVE_KEY})["']?\s*[:=]\s*)(?:\[redacted\][^,;}\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\{.*\}|\[.*\]|[^,;}\]]+)`,
  "gi",
);
const ENCODED_BYTES = /(?:%[\da-f]{2})+/gi;

export function redactErrorText(value: string): string {
  if (value.length > MAX_INPUT_LENGTH) return "Error text omitted (size limit)";
  let text = value;
  for (let pass = 0; pass < 3; pass++) {
    text = text.replace(ENCODED_BYTES, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return REDACTED;
      }
    });
  }
  return text
    .replace(ENCODED_BYTES, REDACTED)
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      REDACTED,
    )
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/(\b(?:set-cookie|cookie)\s*[:=]\s*)[^\r\n]*/gi, `$1${REDACTED_FIELD}`)
    .replace(SENSITIVE_FIELD, `$1${REDACTED_FIELD}`)
    .replace(/\b(Bearer|Basic)\s+[\w+/.~=-]+/gi, `$1 ${REDACTED}`)
    .replace(/\b(?:https?|wss?|tauri|asset|app|ftp|file|blob|data):[^\s<>"')}]+/gi, REDACTED)
    .replace(/(["'])(?:[A-Za-z]:[\\/]|\/(?=[\p{L}\p{N}_.~-])|\\\\).*?\1/gu, REDACTED)
    .replace(
      /(^|[\s("'=])(?:[A-Za-z]:[\\/]|\\\\|\/(?=[\p{L}\p{N}_.~-]))[^,;)\]}]+/gu,
      `$1${REDACTED}`,
    )
    .replace(/"(?:\\.|[^"\\])*"@[\p{L}\p{N}.-]+/gu, REDACTED)
    .replace(/[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}.-]+/gu, REDACTED)
    .replace(/\bplayer-[a-z0-9]{6}\b/gi, REDACTED)
    .replace(/\beyJ[\w-]+\.[\w-]+(?:\.[\w-]*)?\b/g, REDACTED)
    .replace(
      /\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-(?:proj-)?[\w-]+|(?:AKIA|ASIA)[A-Z\d]{16})\b/g,
      REDACTED,
    )
    .replace(/\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/gi, REDACTED)
    .replace(/\b[\da-f]{24,64}\b/gi, REDACTED)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, REDACTED)
    .replace(/(?<![\w:])(?:[\da-f]{0,4}:){2,}[\da-f:.]*(?:%[^\s,;)\]}"']+)?(?![\w:])/gi, REDACTED)
    .replace(/(?<!\w)\+?\d[\d ().-]*\d(?!\w)/g, (number) =>
      number.replace(/\D/g, "").length >= 7 ? REDACTED : number,
    )
    .replace(/[\w+/=-]{32,}/g, (token) =>
      token.length >= 64 || /\d/.test(token) ? REDACTED : token,
    )
    .slice(0, MAX_MESSAGE_LENGTH);
}
