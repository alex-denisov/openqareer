/**
 * Один и тот же признак «заголовок вакансии похож на роль» — сервер считает
 * им вакансий на роль кампании (`countMatchedVacanciesByRole`), а экран
 * «Вакансии» тем же признаком выбирает записи под выбранный чип роли
 * (B248). Общее место, а не два похожих правила: разошедшиеся версии дали
 * бы разный счёт в баннере «N совпадений» и в списке под тем же фильтром.
 */
function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
      .replace(/\s+/g, ' ')
      // Chief Technical Officer — тот же CTO; вне C-level «technical» и «technology» разные слова.
      .replace(/\b(?:chief technical|technical officer)\b/gu, (phrase) =>
        phrase.replace('technical', 'technology'),
      )
      .trim()
  );
}

/** Фраза `part` целиком, словами подряд: «cto» не находится внутри «director» (B766). */
function containsPhrase(words: readonly string[], part: readonly string[]): boolean {
  if (part.length === 0 || part.length > words.length) return false;
  for (let start = 0; start + part.length <= words.length; start += 1) {
    if (part.every((word, index) => words[start + index] === word)) return true;
  }
  return false;
}

/**
 * Слова должности и связки: функцию они не называют. «Chief … Officer», «Head of …» и «Директор
 * по …» общие у любых функций, поэтому одни они роль не сводят (B766).
 */
const RANK_WORDS: ReadonlySet<string> = new Set(
  (
    'chief officer director head vp svp evp avp vice president executive deputy associate ' +
    'assistant senior interim acting group global regional of the and for in at to ' +
    'директор директора руководитель начальник заместитель вице президент главный старший ' +
    'исполнительный департамента отдела управления службы направления группы по и в на с'
  ).split(' '),
);

function wordsOf(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean);
}

/** Одно название целиком стоит внутри другого — самое сильное совпадение по словам. */
export function titleContainsRole(title: string, role: string): boolean {
  const titleWords = wordsOf(title);
  const roleWords = wordsOf(role);
  return containsPhrase(titleWords, roleWords) || containsPhrase(roleWords, titleWords);
}

/** «Head of Information Technology» и «Head of IT» — общая функция, хоть слова и разные. */
const SPELLED_OUT: ReadonlyMap<string, readonly string[]> = new Map([
  ['ai', ['artificial', 'intelligence']],
  ['it', ['information', 'technology']],
]);

function withAbbreviations(words: readonly string[]): string[] {
  const added = [...SPELLED_OUT].flatMap(([short, phrase]) =>
    !words.includes(short) && containsPhrase(words, phrase) ? [short] : [],
  );
  return [...words, ...added];
}

export function titleMatchesRole(title: string, role: string): boolean {
  const titleWords = wordsOf(title);
  const roleWords = wordsOf(role);
  if (roleWords.length === 0) return false;
  if (containsPhrase(titleWords, roleWords) || containsPhrase(roleWords, titleWords)) return true;
  const known = withAbbreviations(titleWords);
  const shared = withAbbreviations(roleWords).filter((word) => known.includes(word));
  return shared.length >= 2 && shared.some((word) => !RANK_WORDS.has(word));
}
