// Port of freehire internal/dict/wordmatch and classify/cjk.go titleBoundary
// (MIT, Copyright (c) 2026 freehire contributors).
import { CATEGORY_NONE, type AliasEntry } from './aliasEntry';

export type Boundary = (text: string, start: number, end: number) => boolean;

const WORD_RUNE = /^[\p{L}\p{Nd}]$/u;
const CJK_RUNE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]$/u;

function isWordRune(char: string): boolean {
  return WORD_RUNE.test(char);
}

function isCjk(char: string): boolean {
  return CJK_RUNE.test(char);
}

/** Code point that ends right before `index` (surrogate-pair aware). */
function charBefore(text: string, index: number): string {
  const low = text.charCodeAt(index - 1);
  if (index >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text.slice(index - 1, index);
}

function charAt(text: string, index: number): string {
  return String.fromCodePoint(text.codePointAt(index) ?? 0);
}

/** wordmatch.UnicodeBoundary: no letter or digit right outside the span. */
export const unicodeBoundary: Boundary = (text, start, end) =>
  !(start > 0 && isWordRune(charBefore(text, start))) &&
  !(end < text.length && isWordRune(charAt(text, end)));

function edgeFree(neighbour: string, edge: string): boolean {
  return !isWordRune(neighbour) || isCjk(edge) || isCjk(neighbour);
}

/**
 * cjk.go titleBoundary: a kana/kanji alias edge needs no boundary on that side, and a
 * CJK neighbour counts as a boundary for a Latin edge; Latin beside Latin keeps the
 * word boundary.
 */
export const titleBoundary: Boundary = (text, start, end) => {
  const first = charAt(text, start);
  const last = charBefore(text, end);
  if (start > 0 && !edgeFree(charBefore(text, start), first)) return false;
  if (end < text.length && !edgeFree(charAt(text, end), last)) return false;
  return true;
};

/** wordmatch.Contains: some occurrence of `term` in `text` satisfies `boundary`. */
export function containsWord(text: string, term: string, boundary: Boundary): boolean {
  if (term === '') return false;
  for (let from = 0; ; ) {
    const index = text.indexOf(term, from);
    if (index < 0) return false;
    if (boundary(text, index, index + term.length)) return true;
    from = index + 1;
  }
}

/** classify.matchOrdered: canonical of the first alias (table order) found whole-word. */
export function matchOrdered(title: string, table: readonly AliasEntry[]): string {
  for (const [alias, canonical] of table) {
    if (containsWord(title, alias, titleBoundary)) return canonical;
  }
  return '';
}

/** Splits like Go strings.Fields and joins with one space. */
export function collapseFields(text: string): string {
  return text.split(/\s+/u).filter(Boolean).join(' ');
}

export { CATEGORY_NONE };
