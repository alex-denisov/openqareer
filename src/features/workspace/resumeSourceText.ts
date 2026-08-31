/**
 * The PDF inspector (`@firecrawl/pdf-inspector-wasm`) returns **Markdown**, not
 * the flat text the resume heuristics were written for. Left as-is it produced
 * a target role of `## IT Директор / CIO / CTO`, "skills" like
 * `|Linux Software Development|||` and a name taken from a certificate list.
 *
 * This module is the single place that turns any extracted source — Markdown
 * from the inspector, the pdf.js fallback, an hh.ru page or a pasted CV — into
 * the plain text every downstream parser expects. It only removes markup: it
 * never invents, reorders or summarises a line, so a fact the source did not
 * state cannot appear here.
 */

const HTML_ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/gu, ' '],
  [/&amp;/gu, '&'],
  [/&lt;/gu, '<'],
  [/&gt;/gu, '>'],
  [/&quot;/gu, '"'],
  [/&#0?39;/gu, "'"],
  [/&apos;/gu, "'"],
];

export function normalizeResumeSourceText(raw: string): string {
  if (!raw) return '';
  const withoutMarkup = [
    stripPageMarkers,
    decodeEntities,
    stripHtmlTags,
    flattenTables,
    stripHeadingMarkers,
    normalizeBullets,
    stripEmphasis,
    resolveLinks,
    spaceAfterLeadingDash,
    tightenTokenSpacing,
  ].reduce((text, step) => step(text), raw.replace(/\r\n?/gu, '\n'));
  return collapseBlankLines(withoutMarkup);
}

/** `<!-- Page 2 -->` and the printed `Page 2 of 4` footers carry no facts. */
function stripPageMarkers(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/gu, '\n')
    .replace(/^\s*Page \d+ of \d+\s*$/gimu, '')
    .replace(/^\s*Страница \d+ из \d+\s*$/gimu, '');
}

function decodeEntities(text: string): string {
  return HTML_ENTITIES.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
}

/**
 * Inline `<u>`, `<b>` and `<br>` survive the inspector. Angle brackets that are
 * not a tag (`<scale>`, `<10%`) are left alone so a real claim is not eaten.
 */
function stripHtmlTags(text: string): string {
  return text
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/?(?:u|b|i|em|strong|span|p|div|sub|sup|mark|small)\b[^>]*>/giu, '');
}

/**
 * A Markdown table row holds several independent items — hh.ru prints the whole
 * skill cloud as one. Each non-empty cell becomes its own line; the
 * `|---|---|` separator row is dropped.
 */
function flattenTables(text: string): string {
  return text
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [line];
      if (/^\|[\s:|-]+\|$/u.test(trimmed)) return [];
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean);
      return cells.length > 0 ? cells : [];
    })
    .join('\n');
}

/**
 * A heading becomes a bare line so `SECTION_DELIMITERS` matches it, and it is
 * kept on its own line so a heading never glues onto the paragraph above.
 */
function stripHeadingMarkers(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/u, '').replace(/\s+#+\s*$/u, ''))
    .join('\n');
}

function normalizeBullets(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^(\s*)[*+•·]\s+/u, '$1- '))
    .join('\n');
}

/**
 * `**bold**` and `_italic_` are removed only in pairs, so `@marina_orlova`,
 * `KL 011.80` and a lone asterisk in a footnote survive untouched.
 */
function stripEmphasis(text: string): string {
  return text
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/gu, '$1')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/gu, '$1')
    .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=[\s).,;:!?]|$)/gu, '$1$2')
    .replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=[\s).,;:!?]|$)/gu, '$1$2');
}

/**
 * `[text](url)` keeps whatever a human would read out loud: the address when
 * the label is the address, both otherwise, so `extractContacts` still finds
 * the link.
 */
function resolveLinks(text: string): string {
  return text.replace(
    /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu,
    (_match, label: string, url: string) => {
      const trimmedLabel = label.trim();
      if (!trimmedLabel) return url;
      if (trimmedLabel === url || trimmedLabel.replace(/\/+$/u, '') === url.replace(/\/+$/u, '')) {
        return url;
      }
      return `${trimmedLabel} (${url})`;
    },
  );
}

/**
 * hh.ru prints `Апрель 2023 —**АО "Россети Цифра"**`; once the emphasis is gone
 * the employer is welded to the dash and no date/employer split matches.
 */
function spaceAfterLeadingDash(text: string): string {
  return text.replace(/(\s[—–])(?=[^\s—–])/gu, '$1 ');
}

/**
 * pdf.js hands back one text item per token, so an hh.ru export arrives as
 * `Проживает : Москва`, `Мужчина , 37 лет` and `ИТ - директор`. Every heuristic
 * downstream looks for `Проживает:` and never matches, so the candidate loses
 * their city, contacts and target role (B178).
 *
 * Only spacing is repaired: no word is added, removed or reordered. The in-word
 * hyphen is joined only between two letters, so a line-leading `- ` bullet and
 * a real dash between numbers stay as they are.
 */
function tightenTokenSpacing(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/\s+([,;:.!?])(\s|$)/gu, '$1$2')
        .replace(/([«(])\s+/gu, '$1')
        .replace(/\s+([»)])/gu, '$1')
        // A straight quote is both the opening and the closing mark, so it is
        // only tightened as a pair: `АО " Россети Цифра "` keeps the space that
        // separates it from `АО`.
        .replace(/"\s*([^"\n]*?)\s*"/gu, '"$1"')
        .replace(/(\p{L})\s-\s(\p{L})/gu, '$1-$2')
        .replace(/(\d)-\s+(\p{L})/gu, '$1-$2'),
    )
    .join('\n');
}

function collapseBlankLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
