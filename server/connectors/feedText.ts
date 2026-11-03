/**
 * Text as a feed writes it, turned into text a candidate can read. Feeds wrap
 * fields in CDATA and escape their characters; a card that prints
 * `<![CDATA[…]]>` or `&nbsp;` back shows the encoding rather than the vacancy
 * (both found on the B164 prod walk).
 */
export function unwrapCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  thinsp: ' ', shy: '', zwnj: '', zwj: '', mdash: '—', ndash: '–', hellip: '…',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“',
  rdquo: '”', bdquo: '„', lsaquo: '‹', rsaquo: '›', bull: '•', middot: '·',
  deg: '°', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥',
  cent: '¢', sect: '§', para: '¶', times: '×', divide: '÷', plusmn: '±',
  frac12: '½', frac14: '¼', frac34: '¾', micro: 'µ', larr: '←', rarr: '→',
  uarr: '↑', darr: '↓', check: '✓', star: '☆', dagger: '†', permil: '‰',
  prime: '′', Prime: '″', minus: '−', ne: '≠', le: '≤', ge: '≥', infin: '∞',
  acute: '´', uml: '¨', iexcl: '¡', iquest: '¿', ordf: 'ª', ordm: 'º',
  sup1: '¹', sup2: '²', sup3: '³', not: '¬', macr: '¯', cedil: '¸',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
  aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ', ograve: 'ò',
  oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù',
  uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', szlig: 'ß',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Iacute: 'Í', Ntilde: 'Ñ', Oacute: 'Ó', Ouml: 'Ö', Oslash: 'Ø', Uacute: 'Ú',
  Uuml: 'Ü',
};

const DOUBLE_ESCAPED = /&amp;(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/**
 * Feeds escape their text; a card that prints `&nbsp;` or `&#8212;` back at the
 * candidate shows the escaping rather than the vacancy (B164 prod walk).
 * Indeed escapes twice (`&amp;rsquo;`, 62% of its prod rows), so an `&amp;`
 * that wraps another escape is unwrapped first.
 */
export function decodeFeedEntities(text: string): string {
  let unwrapped = text;
  for (let i = 0; i < 3 && DOUBLE_ESCAPED.test(unwrapped); i += 1) {
    DOUBLE_ESCAPED.lastIndex = 0;
    unwrapped = unwrapped.replace(DOUBLE_ESCAPED, '&$1;');
  }
  DOUBLE_ESCAPED.lastIndex = 0;
  return decodeOnce(unwrapped);
}

/** One decode pass, used by the markup stripper whose own second pass handles `&amp;lt;`. */
function decodeOnce(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_match, code: string) => codePoint(Number.parseInt(code, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_match, code: string) =>
      codePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function codePoint(code: number): string {
  // The range check is what keeps `fromCodePoint` from throwing, so there is
  // nothing left for a catch block to do here.
  if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return '';
  return String.fromCodePoint(code);
}

/**
 * Some feeds escape a whole HTML document into their description. Decoding it
 * gives back markup, not something a candidate can read — and that markup then
 * fed the skill extractor, the salary parser and the fingerprint (B164).
 */
export function htmlToFeedText(html: string): string {
  // Some boards escape their HTML once on the way out, so one pass leaves the
  // markup intact — `&lt;p&gt;` decodes to `<p>` with nothing left to strip it.
  // Two passes read both shapes; a third would only chase text that legitimately
  // mentions a tag.
  let text = html;
  for (let pass = 0; pass < 2; pass += 1) {
    const stripped = decodeOnce(
      text
        .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, ' ')
        // Safe text keeps the structure candidates need, but never the source
        // markup itself: React only receives strings and creates the elements.
        .replace(/<\/?(?:p|div|section|article|h[1-6]|blockquote)\b[^>]*>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '\n- ')
        .replace(/<\/li>/gi, '')
        .replace(/<[^>]+>/g, ' '),
    );
    if (stripped === text) break;
    text = stripped;
  }
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
