/**
 * Vacancy text from sources arrives with HTML entities left in it
 * («Oregon Tilth&rsquo;s», G5 M2); decode the ones job boards actually write.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  laquo: '«',
  raquo: '»',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  middot: '·',
  euro: '€',
  pound: '£',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** Accented letters: «tr&egrave;s», «M&uuml;nchen» — base letter plus combining mark. */
const ACCENT_MARKS: Readonly<Record<string, string>> = {
  grave: '\u0300',
  acute: '\u0301',
  circ: '\u0302',
  tilde: '\u0303',
  uml: '\u0308',
  ring: '\u030A',
  cedil: '\u0327',
};
const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  szlig: 'ß',
  aelig: 'æ',
  AElig: 'Æ',
  oslash: 'ø',
  Oslash: 'Ø',
  oelig: 'œ',
  OElig: 'Œ',
};

function accentedLetter(body: string): string | null {
  if (SPECIAL_LETTERS[body]) return SPECIAL_LETTERS[body];
  const match = /^([a-zA-Z])(grave|acute|circ|tilde|uml|ring|cedil)$/u.exec(body);
  return match ? (match[1] + ACCENT_MARKS[match[2]]).normalize('NFC') : null;
}

function codePoint(value: number): string | null {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : null;
}

export function decodeVacancyText(value: string): string {
  // Two passes cover double-encoded «&amp;rsquo;».
  return decodeOnce(decodeOnce(value));
}

function decodeOnce(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X'))
      return codePoint(Number.parseInt(body.slice(2), 16)) ?? entity;
    if (body.startsWith('#')) return codePoint(Number(body.slice(1))) ?? entity;
    return accentedLetter(body) ?? NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}
