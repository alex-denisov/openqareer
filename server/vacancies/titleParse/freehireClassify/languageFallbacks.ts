// Port of freehire internal/dict/classify german.go matchHeads/headOf, spanish.go
// foldSpanish/matchSpanishCategory, portuguese.go matchPortugueseCategory
// (MIT, Copyright (c) 2026 freehire contributors).
import { CATEGORY_NONE, type AliasEntry } from './aliasEntry';
import { CATEGORY_TABLE, PORTUGUESE_TABLE, SPANISH_TABLE } from './tables';
import { collapseFields, containsWord, matchOrdered, unicodeBoundary } from './wordMatch';

const GERMAN_GENDER_MARKER = /\(\s*[mwdfxv](?:\s*[/|,·]\s*[mwdfxv])+\s*\)/gu;
const NON_HEAD_CHAR = /[^\p{L}-]+/u;

/** headOf: index of the first head entry ("-suffix") the word ends in, or -1. */
function headOf(word: string, table: readonly AliasEntry[]): number {
  if (word === '') return -1;
  const forms = [word];
  if (word.endsWith('innen') && word.length > 5) forms.push(word.slice(0, -5));
  else if (word.endsWith('in') && word.length > 2) forms.push(word.slice(0, -2));
  return table.findIndex(
    ([alias]) => alias.startsWith('-') && forms.some((form) => form.endsWith(alias.slice(1))),
  );
}

function resolvedHeads(lower: string, table: readonly AliasEntry[]): ReadonlySet<number> {
  const resolved = new Set<number>();
  for (const word of lower.split(NON_HEAD_CHAR).filter(Boolean)) {
    const parts = word.includes('-') ? [...word.split('-'), word] : [word];
    for (const part of parts) {
      const index = headOf(part, table);
      if (index >= 0) resolved.add(index);
    }
  }
  return resolved;
}

/**
 * matchHeads (German, Dutch, Danish): the first entry that is a whole-word phrase of
 * the title or the resolved head of one of its words; a head veto claims its word and
 * never ends the walk. categoryNone is served as "".
 */
export function matchHeads(input: string, table: readonly AliasEntry[]): string {
  const lower = collapseFields(input.replace(GERMAN_GENDER_MARKER, ' '));
  const resolved = resolvedHeads(lower, table);
  for (const [index, [alias, canonical]] of table.entries()) {
    const hit = alias.startsWith('-')
      ? resolved.has(index) && canonical !== CATEGORY_NONE
      : containsWord(lower, alias, unicodeBoundary);
    if (hit) return canonical === CATEGORY_NONE ? '' : canonical;
  }
  return '';
}

const SPANISH_GENDER_MARKER = /\(\s*[hmwdfxv](?:\s*[/|,·]\s*[hmwdfxv])+\s*\)/gu;
const SPANISH_GENDER_SLASH = /(\p{L})[/-](?:as|os|es|a|o|ra|ora)\b/gu;
const COMBINING_MARK = /\p{Mn}/gu;

export function foldSpanishGender(lower: string): string {
  return collapseFields(
    lower.replace(SPANISH_GENDER_MARKER, ' ').replace(SPANISH_GENDER_SLASH, '$1'),
  );
}

export function foldSpanish(lower: string): string {
  return foldSpanishGender(lower)
    .normalize('NFD')
    .replace(COMBINING_MARK, '')
    .replace(/ª/gu, 'a')
    .replace(/º/gu, 'o');
}

/** May return the categoryNone sentinel (a Spanish veto ends the chain). */
export function matchSpanishCategory(lower: string): string {
  const gendered = foldSpanishGender(lower);
  const fromMain = gendered !== lower ? matchOrdered(gendered, CATEGORY_TABLE) : '';
  return fromMain || matchOrdered(foldSpanish(lower), SPANISH_TABLE);
}

export function matchPortugueseCategory(lower: string): string {
  return matchOrdered(foldSpanish(lower), PORTUGUESE_TABLE);
}
