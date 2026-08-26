/**
 * The small markup readers both hh.ru parsers share.
 *
 * The desktop shell hands us a DOM stripped of every attribute except
 * `data-qa`, `class` and resume `href`s, so these helpers work on that
 * reduced markup rather than on a live document.
 */

/**
 * hh.ru writes `&nbsp;` between every number and its unit, and inside the
 * resume-card titles. Left encoded, it reaches the profile as literal
 * `&nbsp;` text (owner report, 2026-08-26).
 */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

export function decodeHtmlText(value: string): string {
  return value
    .replace(/&(?:nbsp|amp|quot|#39|apos|lt|gt);/gu, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)));
}

export function plainText(html: string): string {
  return decodeHtmlText(html.replace(/<[^>]+>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();
}

export function extractTagContent(html: string, tagAttrPattern: RegExp): string | null {
  const match = tagAttrPattern.exec(html);
  if (!match) return null;
  return plainText(match[1] ?? match[2] ?? '') || null;
}

export function extractAllTagContents(html: string, tagAttrPattern: RegExp): string[] {
  const results: string[] = [];
  const regex = new RegExp(
    tagAttrPattern.source,
    tagAttrPattern.flags.includes('g') ? tagAttrPattern.flags : `${tagAttrPattern.flags}g`,
  );
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const text = plainText(match[1] ?? match[2] ?? '');
    if (text && !results.includes(text)) {
      results.push(text);
    }
  }
  return results;
}
