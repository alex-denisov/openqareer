/**
 * B753 (решение CPO 23.11): черновик VK выдумал близость — «Александрыч», «мы же на ты, помнишь?»,
 * а другой вставил «owning P&L» в русский текст. Такой текст модель переписывает, затем шаблон.
 */
export type ToneRejection = 'informal_address' | 'greeting_name' | 'invented_history' | 'latin_word';

export interface ToneCard {
  readonly recipientName: string;
  /** Профиль, карточка и вакансия одной строкой: откуда латиница допустима. */
  readonly known: string;
  readonly language: 'en' | 'ru';
  /** Как знакомы, из карточки; пусто — связь не подтверждена. */
  readonly relationship?: string | null;
}

const word = (alternatives: string) => new RegExp(`(?<!\\p{L})(${alternatives})(?!\\p{L})`, 'iu');

const INFORMAL = word('ты|тебя|тебе|тобой|тобою|твой|твоя|твоё|твое|твои|твоего|твоей|твоему|твоих|твоим|здравствуй');
const INFORMAL_ALLOWED = /на\s*«?ты»?/iu;
const HISTORY = word('помнишь|помните|как мы с тобой|как мы с вами|мы же');
const GREETING_WORDS = new Set([
  'здравствуйте', 'здравствуй', 'добрый', 'доброе', 'день', 'утро', 'вечер', 'привет', 'уважаемый', 'уважаемая',
  'hi', 'hello', 'hey', 'dear', 'good', 'morning', 'afternoon', 'evening',
]);
const LATIN_WORD = /\p{Script=Latin}[\p{Script=Latin}\d]*/gu;

const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'iu', я: 'ia',
};

/** Скелет имени: латиница и кириллица одного имени дают одну строку (Alexandr = Александр). */
function nameSkeleton(name: string): string {
  const latin = [...name.toLowerCase()].map((char) => CYRILLIC_TO_LATIN[char] ?? char).join('');
  return latin
    .replace(/kh/gu, 'h').replace(/x/gu, 'ks').replace(/[yj]/gu, 'i').replace(/w/gu, 'v')
    .replace(/ph/gu, 'f').replace(/ck|c|q/gu, 'k').replace(/[^a-z]/gu, '');
}

/** Слова обращения: первая часть до запятой, а если в ней только приветствие — вторая. */
function greetingWords(body: string): string[] {
  const opening = body.trim().split(/[!.?\n]/u)[0] ?? '';
  const parts = opening.split(',').map((part) => part.match(/\p{L}+/gu) ?? []);
  const names = (part: readonly string[]) => part.filter((item) => !GREETING_WORDS.has(item.toLowerCase()));
  const first = names(parts[0] ?? []);
  return first.length > 0 || (parts[0]?.length ?? 0) === 0 ? first : names(parts[1] ?? []);
}

function strangeGreetingName(body: string, recipientName: string): boolean {
  const allowed = new Set((recipientName.match(/\p{L}+/gu) ?? []).map(nameSkeleton));
  return greetingWords(body).some((item) => !allowed.has(nameSkeleton(item)));
}

function strangeLatinWord(body: string, known: string): boolean {
  const allowed = new Set((known.match(LATIN_WORD) ?? []).map((item) => item.toLowerCase()));
  return (body.match(LATIN_WORD) ?? []).some((item) => !allowed.has(item.toLowerCase()));
}

export function toneRejection(body: string, card: ToneCard): ToneRejection | null {
  const relationship = card.relationship?.trim() ?? '';
  if (card.language === 'ru' && INFORMAL.test(body) && !INFORMAL_ALLOWED.test(relationship)) return 'informal_address';
  if (strangeGreetingName(body, card.recipientName)) return 'greeting_name';
  if (HISTORY.test(body) && !relationship) return 'invented_history';
  if (card.language === 'ru' && strangeLatinWord(body, card.known)) return 'latin_word';
  return null;
}
