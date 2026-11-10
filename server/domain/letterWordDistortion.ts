/**
 * B640: GLM на проде искажала слова письма — «С СБером меня связывает…», «Я руководител…».
 * Словаря русского языка в зависимостях нет, поэтому проверка узкая (решение CPO 10.11):
 * - сбой регистра: слово из профиля или вакансии с лишними заглавными («СБером» при «Сбера»);
 * - обрезанное окончание: «-ител»/«-ател» без мягкого знака или слово, которое в источниках
 *   и в самом письме стоит с «ь»/«й» на конце.
 * Аббревиатуры с окончанием («ЦОДа») не ловятся: в источниках они написаны заглавными.
 */
const WORD = /\p{L}+/gu;
const CYRILLIC = /^\p{Script=Cyrillic}+$/u;
const MIN_LENGTH = 6;
const MIN_STEM = 4;
const CUT_SUFFIX = /[иа]тел$/u;
const DROPPED_ENDINGS = ['ь', 'й'] as const;

function wordsOf(text: string): string[] {
  return text.match(WORD) ?? [];
}

const lower = (word: string) => word.toLocaleLowerCase('ru-RU');
const isNormalCase = (word: string) => word.slice(1) === lower(word.slice(1));

/** Заглавные там, где их нет ни у одного написания этого слова в источниках. */
function hasCaseBreak(word: string, normalSources: readonly string[]): boolean {
  if (!CYRILLIC.test(word) || isNormalCase(word) || word === word.toLocaleUpperCase('ru-RU')) return false;
  const plain = lower(word);
  return normalSources.some((source) => {
    const known = lower(source);
    let prefix = 0;
    while (prefix < known.length && known[prefix] === plain[prefix]) prefix += 1;
    return prefix >= MIN_STEM;
  });
}

function hasCutEnding(word: string, vocabulary: ReadonlySet<string>, sourceWords: ReadonlySet<string>): boolean {
  const plain = lower(word);
  if (!CYRILLIC.test(plain) || plain.length < MIN_LENGTH || sourceWords.has(plain)) return false;
  return CUT_SUFFIX.test(plain) || DROPPED_ENDINGS.some((ending) => vocabulary.has(`${plain}${ending}`));
}

/** Искажённые слова письма в порядке появления, без повторов. */
export function distortedWords(body: string, sources: readonly string[]): string[] {
  const sourceList = sources.flatMap(wordsOf);
  const normalSources = [...new Set(sourceList.filter((word) => CYRILLIC.test(word) && isNormalCase(word)))];
  const sourceWords = new Set(sourceList.map(lower));
  const vocabulary = new Set([...sourceWords, ...wordsOf(body).map(lower)]);
  const distorted = wordsOf(body).filter(
    (word) => !sourceList.includes(word) && (hasCaseBreak(word, normalSources) || hasCutEnding(word, vocabulary, sourceWords)),
  );
  return [...new Set(distorted)];
}
