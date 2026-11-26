/**
 * Требование вакансии в тексте резюме — только целым термином: «Go» не находится в «go-to-market»,
 * «C» — в «C++» и «C#», «R» — в «R&D», «NET» — в «.NET». Внутри термина пробел и дефис равны.
 * Дефис между латиницей и кириллицей термин не продолжает: «Go-разработчик» — это Go.
 */
const SEPARATOR = /[^\p{L}\p{N}+#.&]+/u;
const BEFORE = String.raw`(?<![\p{L}\p{N}+#&]|[\p{L}\p{N}][-.]|(?:^|[^\p{L}\p{N}])\.)`;
const AFTER = String.raw`(?![\p{L}\p{N}+#&]|\.[\p{L}\p{N}])`;
const AFTER_LATIN = String.raw`(?!-[\p{Script=Latin}\p{N}])`;
const AFTER_CYRILLIC = String.raw`(?!-[\p{Script=Cyrillic}\p{N}])`;
const SHORT_LATIN = /^[a-z]{1,2}$/iu;
/** «Go to market» без дефисов — тоже не язык. */
const NOT_GO_TO = String.raw`(?!\s+to\b)`;

const escaped = (value: string) => value.replace(/[.+]/gu, String.raw`\$&`);

function tokensOf(requirement: string): string[] {
  return requirement
    .trim()
    .split(SEPARATOR)
    .map((token) => token.replace(/[.&]+$/u, ''))
    .filter((token) => /[\p{L}\p{N}]/u.test(token));
}

function patternOf(requirement: string): RegExp | null {
  const tokens = tokensOf(requirement);
  const term = tokens.join(' ');
  if (!term) return null;
  const tail = /\p{Script=Cyrillic}$/u.test(term) ? AFTER_CYRILLIC : AFTER_LATIN;
  const goTo = /^go$/iu.test(term) ? NOT_GO_TO : '';
  const body = tokens.map(escaped).join(String.raw`[^\p{L}\p{N}]+`);
  return new RegExp(`${BEFORE}${body}${AFTER}${tail}${goTo}`, 'giu');
}

export function termAppears(requirement: string, text: string): boolean {
  const pattern = patternOf(requirement);
  if (!pattern) return false;
  // Короткое латинское слово строчными («go», «r») — не название языка.
  const short = SHORT_LATIN.test(requirement.trim());
  return [...text.matchAll(pattern)].some(
    ([found]) => !short || found !== found.toLocaleLowerCase('en-US'),
  );
}
