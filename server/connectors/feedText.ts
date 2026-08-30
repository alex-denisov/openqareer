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
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
};

/**
 * Feeds escape their text; a card that prints `&nbsp;` or `&#8212;` back at the
 * candidate shows the escaping rather than the vacancy (B164 prod walk).
 * Each escape is resolved exactly once, so a double-escaped `&amp;nbsp;` comes
 * out as the literal `&nbsp;` the feed meant to print rather than a space.
 */
export function decodeFeedEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_match, code: string) => codePoint(Number.parseInt(code, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_match, code: string) =>
      codePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match)
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
    const stripped = decodeFeedEntities(
      text
        .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    );
    if (stripped === text) break;
    text = stripped;
  }
  return text.replace(/\s+/g, ' ').trim();
}
