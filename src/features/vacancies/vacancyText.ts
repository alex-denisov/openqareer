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
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}
