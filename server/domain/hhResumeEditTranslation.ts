import type { HhResumeEdit, HhResumeEditSection } from '../../shared/hhCandidateSession';
import { arithmeticFails, numbersAreSourced, speaksInFirstPerson } from './experienceFactRewrite';
import { textLanguage } from './profileLanguage';
import { addsPersonalAction, type LetterFactTranslator } from './letterFactTranslation';
import type { HhEditDraft, HhEditLanguage } from './hhResumeEdits';

/**
 * B678: «станет» на языке резюме hh.ru. Строки правки уходят одним запросом тому же переводчику, что
 * пункты «Опыта», и каждая проходит те же проверки: ни числа, ни личного действия сверх исходного текста.
 * Строка не перевелась за отведённое время — правка не показывается: смеси языков в резюме нет.
 * Переводим не больше TRANSLATED_LINES_MAX строк на разбор: правки сверх потолка не показываются.
 */
export const TRANSLATED_LINES_MAX = 40;

interface Line {
  readonly key: string;
  readonly text: string;
  readonly section: HhResumeEditSection;
}

function expiresIn(budgetMs: number): { readonly promise: Promise<void>; readonly cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/** Перевод не длиннее вдвое: «О себе» длиннее пункта опыта, но перевод не дописывает своего. */
const LENGTH_RATIO = 2;
const LENGTH_FLOOR = 320;
/**
 * B787: пункт резюме начинается с глагола кандидата («Grew revenue…», «Improved…»): действие в нём
 * уже названо, и русское «Увеличил выручку» его не добавляет. Проверка личного действия нужна там,
 * где исходник без субъекта говорит о событии («команда выросла»).
 */
const OPENS_WITH_VERB = /^(?:[-–—•*]\s*)?(?:\p{Lu}\p{Ll}+ed|Grew|Rebuilt|Built|Brought|Sold|Won|Made|Ran|Took|Set|Kept|Led|Drove|Oversaw|Cut|Began|Became|Wrote|Taught)(?!\p{L})/u;

const opensWithOwnVerb = (text: string) => text.split(/(?<=[.;!?])\s+|\n+/u).some((sentence) => OPENS_WITH_VERB.test(sentence.trim()));

const SCRIPT: Readonly<Record<HhEditLanguage, RegExp>> = { ru: /\p{Script=Cyrillic}/u, en: /\p{Script=Latin}/u };

/** Язык перевода: в строке есть буквы нужного письма; почта и ники латиницей языка строки не меняют. */
function inLanguage(text: string, language: HhEditLanguage): boolean {
  const written = textLanguage(text);
  return !written || written === language || SCRIPT[language].test(text);
}

/**
 * Проверка перевода строки правки hh.ru: те же числа, тот же язык, лица и действия не больше, чем в
 * исходнике. Это перевод уже подтверждённого текста, а не новый пункт: длина и «я» берутся от исходника.
 * «О себе» — собственный текст кандидата от первого лица: проверка личного действия нужна только опыту.
 */
/** B787: exit через продажу — продажа компании; «вышла из бизнеса» по-русски значит «закрылась». */
const EXIT_SOURCE = /\b(?:exit|acquisition|acquired)\b/iu;
const EXIT_AS_CLOSURE = /(?:вы(?:шл|ход|ше)\p{L}*|покину\p{L}*|уш[её]л\p{L}*)\s+(?:из\s+)?бизнес/iu;

const MONEY_UNIT: Readonly<Record<string, string>> = { k: 'тыс.', m: 'млн', b: 'млрд' };

/** B787: суммы по-русски одним видом: «$73K» — «73 тыс. $», «$50M+» — «более 50 млн $». */
export function russianMoney(text: string): string {
  return text.replace(/\$\s?(\d+(?:[.,]\d+)?)\s?([KMB])?(\+)?(?![\p{L}\d])/giu, (_all, amount: string, unit?: string, plus?: string) => {
    const value = [amount.replace('.', ','), unit ? MONEY_UNIT[unit.toLowerCase()] : null, '$'].filter(Boolean).join(' ');
    return plus ? `более ${value}` : value;
  }).replace(/(?<!\p{L})(?:свыше|больше|более чем)(?=\s+\d[\d,]*\s(?:тыс\.|млн|млрд)\s\$)/giu, 'более');
}

export function checkedTranslation(
  source: string,
  answer: string | undefined,
  language: HhEditLanguage,
  section: HhResumeEditSection = 'experience',
): string | null {
  const text = answer?.trim() ?? '';
  if (!text || text.length > Math.max(LENGTH_FLOOR, source.length * LENGTH_RATIO)) return null;
  if (!numbersAreSourced(text, [source]) || arithmeticFails(text) || !inLanguage(text, language)) return null;
  if (speaksInFirstPerson(text) && !speaksInFirstPerson(source)) return null;
  if (language === 'ru' && EXIT_SOURCE.test(source) && EXIT_AS_CLOSURE.test(text)) return null;
  if (section === 'experience' && !opensWithOwnVerb(source) && addsPersonalAction(source, text)) return null;
  return text;
}

function checkedLine(line: Line, answer: string | undefined, language: HhEditLanguage): string | null {
  return checkedTranslation(line.text, answer, language, line.section);
}

async function translateLines(
  translate: NonNullable<LetterFactTranslator['translate']>,
  lines: readonly Line[],
  language: HhEditLanguage,
): Promise<ReadonlyArray<readonly [string, string]>> {
  try {
    const output = await translate({
      // Строка готового резюме: переводится целиком, без сжатия до «пункта достижения» (B785).
      bullets: lines.map((line) => ({ key: line.key, language, text: line.text, facts: [line.text], line: 'text' as const })),
    });
    return lines.flatMap((line) => {
      const text = checkedLine(line, output?.bullets.find((bullet) => bullet.key === line.key)?.text, language);
      return text ? [[line.key, language === 'ru' ? russianMoney(text) : text] as const] : [];
    });
  } catch {
    return [];
  }
}

/** Правки по порядку, пока их строки укладываются в потолок перевода. */
function withinLineCap(foreign: readonly HhEditDraft[]): HhEditDraft[] {
  return foreign.reduce<{ readonly kept: HhEditDraft[]; readonly used: number }>(
    (state, draft) => {
      const size = linesOf(draft).length;
      return state.used + size > TRANSLATED_LINES_MAX ? state : { kept: [...state.kept, draft], used: state.used + size };
    },
    { kept: [], used: 0 },
  ).kept;
}

/**
 * B787: «О себе» уходит в перевод абзацами: ответ переводчика держит до 1000 знаков на строку, а
 * «О себе» бывает вдвое длиннее — целиком оно не переводилось никогда. Абзацы собираются обратно.
 */
function linesOf(draft: HhEditDraft): Line[] {
  const lines = draft.lines ?? draft.now.split(/\n+/u).filter((line) => line.trim());
  return lines.map((text, index) => ({ key: `${draft.id}#${index}`, text, section: draft.section }));
}

function publicEdit(draft: HhEditDraft, now: string): HhResumeEdit {
  return {
    id: draft.id,
    section: draft.section,
    ...(draft.place ? { place: draft.place } : {}),
    ...(draft.employer ? { employer: draft.employer } : {}),
    ...(draft.position ? { position: draft.position } : {}),
    was: draft.was,
    now,
    ...(draft.added ? { added: draft.added } : {}),
  };
}

/** B787: правки к показу и полный результат перевода, который дойдёт и после срока. */
export interface LocalizedHhEdits {
  readonly edits: HhResumeEdit[];
  /** Перевод уложился в срок: ничего не отброшено из-за ожидания. */
  readonly complete: boolean;
  /** Все правки, когда перевод закончится (или сразу, если он уже закончен). */
  readonly settled: Promise<HhResumeEdit[]>;
}

function assemble(
  drafts: readonly HhEditDraft[],
  foreign: readonly HhEditDraft[],
  skipped: ReadonlySet<HhEditDraft>,
  arrived: ReadonlyMap<string, string>,
): HhResumeEdit[] {
  return drafts.flatMap((draft) => {
    if (skipped.has(draft)) return [];
    if (!foreign.includes(draft)) return [publicEdit(draft, draft.now)];
    const lines = linesOf(draft).map((line) => arrived.get(line.key));
    return lines.every((line): line is string => Boolean(line)) ? [publicEdit(draft, lines.join('\n'))] : [];
  });
}

export async function localizeHhResumeEditsDetailed(
  drafts: readonly HhEditDraft[],
  language: HhEditLanguage,
  translator: LetterFactTranslator | undefined,
  budgetMs: number,
): Promise<LocalizedHhEdits> {
  const foreign = withinLineCap(
    drafts.filter((draft) => draft.section !== 'title' && draft.section !== 'skills' && draft.language !== language),
  );
  const skipped = new Set(
    drafts.filter((draft) => draft.section !== 'title' && draft.section !== 'skills' && draft.language !== language && !foreign.includes(draft)),
  );
  const translate = translator?.translate?.bind(translator);
  const arrived = new Map<string, string>();
  if (foreign.length === 0 || !translate) {
    const edits = assemble(drafts, foreign, skipped, arrived);
    return { edits, complete: true, settled: Promise.resolve(edits) };
  }
  let done = false;
  const all = Promise.all(
    foreign.map((draft) =>
      translateLines(translate, linesOf(draft), language).then((pairs) => pairs.forEach(([key, text]) => arrived.set(key, text))),
    ),
  ).then(() => {
    done = true;
  });
  const deadline = expiresIn(budgetMs);
  await Promise.race([all, deadline.promise]).finally(deadline.cancel);
  const edits = assemble(drafts, foreign, skipped, arrived);
  return {
    edits,
    complete: done,
    settled: done ? Promise.resolve(edits) : all.then(() => assemble(drafts, foreign, skipped, arrived)),
  };
}

export async function localizeHhResumeEdits(
  drafts: readonly HhEditDraft[],
  language: HhEditLanguage,
  translator: LetterFactTranslator | undefined,
  budgetMs: number,
): Promise<HhResumeEdit[]> {
  return (await localizeHhResumeEditsDetailed(drafts, language, translator, budgetMs)).edits;
}
