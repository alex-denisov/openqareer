export type AboutBlock =
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'list'; readonly items: readonly string[] };

const BULLET_PREFIX = /^[-•*]\s+/u;

/**
 * Splits a candidate's free-text "about" into paragraphs and bullet lists
 * (B265 owner remark #6): a source that writes "Что делаю лучше всего:\n-
 * Строю..." on consecutive lines must render as a heading paragraph plus a
 * `<ul>`, not one run-on sentence with the dashes glued onto the words that
 * follow them.
 */
export function parseAboutContent(about: string): readonly AboutBlock[] {
  const lines = about.replace(/\r\n/gu, '\n').split('\n');
  const blocks: AboutBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  function flushParagraph(): void {
    const text = paragraphLines.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', text });
    paragraphLines = [];
  }

  function flushList(): void {
    if (listItems.length) blocks.push({ type: 'list', items: listItems });
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (BULLET_PREFIX.test(line)) {
      flushParagraph();
      listItems.push(line.replace(BULLET_PREFIX, '').trim());
      continue;
    }
    flushList();
    paragraphLines.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}
