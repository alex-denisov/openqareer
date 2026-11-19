/**
 * B645 a02: how a contact reads in «люди, которые нанимают».
 * LinkedIn exports keep whatever the person typed: emoji in the name, a company page
 * in place of a person, the whole headline in the title. The list shows a person and a job title.
 */

const EDGE_NON_LETTERS = /^[^\p{L}]+|[^\p{L}.)]+$/gu;
// `\b` is ASCII-only in JS, so words are bounded by letters explicitly (Cyrillic «ООО»).
const ORGANIZATION =
  /(?<!\p{L})(co\.|ltd|llc|inc|gmbh|corp|plc|ооо|ао|пао|ип|agency|group|solutions)(?!\p{L})|specializ/iu;
const MAX_NAME_WORDS = 5;
const TITLE_CUT = /\s+(?:\||@|at|в)\s+|\s*\|\s*/u;
export const ROLE_TITLE_MAX = 60;

export function cleanPersonName(value: string): string {
  return value.replace(EDGE_NON_LETTERS, '').replace(/\s+/gu, ' ').trim();
}

export function looksLikeOrganization(name: string): boolean {
  return ORGANIZATION.test(name) || name.split(/\s+/u).filter(Boolean).length > MAX_NAME_WORDS;
}

export function shortRoleTitle(value: string): string {
  const head = value.split(TITLE_CUT)[0]!.replace(/\s+/gu, ' ').trim();
  if (head.length <= ROLE_TITLE_MAX) return head;
  const cut = head.slice(0, ROLE_TITLE_MAX);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), 1));
  return `${atWord.trimEnd()}…`;
}
