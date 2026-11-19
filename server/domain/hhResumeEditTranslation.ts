import type { HhResumeEdit } from '../../shared/hhCandidateSession';
import { checkedBullet } from './experienceFactRewrite';
import { addsPersonalAction, type LetterFactTranslator } from './letterFactTranslation';
import type { HhEditDraft, HhEditLanguage } from './hhResumeEdits';

/**
 * B678: «станет» на языке резюме hh.ru. Строки правки уходят одним запросом тому же переводчику, что
 * пункты «Опыта», и каждая проходит те же проверки: ни числа, ни личного действия сверх исходного текста.
 * Строка не перевелась за отведённое время — правка не показывается: смеси языков в резюме нет.
 * Переводим не больше TRANSLATED_LINES_MAX строк на разбор: правки сверх потолка не показываются.
 */
export const TRANSLATED_LINES_MAX = 24;

interface Line {
  readonly key: string;
  readonly text: string;
}

function expiresIn(budgetMs: number): { readonly promise: Promise<void>; readonly cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

function checkedLine(line: Line, answer: string | undefined, language: HhEditLanguage): string | null {
  if (!answer) return null;
  const checked = checkedBullet({ text: answer, sourceFactIds: ['0'] }, new Map([['0', line.text]]), language);
  return checked && !addsPersonalAction(line.text, checked.text) ? checked.text : null;
}

async function translateLines(
  translate: NonNullable<LetterFactTranslator['translate']>,
  lines: readonly Line[],
  language: HhEditLanguage,
): Promise<ReadonlyArray<readonly [string, string]>> {
  try {
    const output = await translate({
      bullets: lines.map((line) => ({ key: line.key, language, text: line.text, facts: [line.text] })),
    });
    return lines.flatMap((line) => {
      const text = checkedLine(line, output?.bullets.find((bullet) => bullet.key === line.key)?.text, language);
      return text ? [[line.key, text] as const] : [];
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

function linesOf(draft: HhEditDraft): Line[] {
  const lines = draft.lines ?? [draft.now];
  return lines.map((text, index) => ({ key: `${draft.id}#${index}`, text }));
}

function publicEdit(draft: HhEditDraft, now: string): HhResumeEdit {
  return { id: draft.id, section: draft.section, ...(draft.place ? { place: draft.place } : {}), was: draft.was, now };
}

export async function localizeHhResumeEdits(
  drafts: readonly HhEditDraft[],
  language: HhEditLanguage,
  translator: LetterFactTranslator | undefined,
  budgetMs: number,
): Promise<HhResumeEdit[]> {
  const foreign = withinLineCap(
    drafts.filter((draft) => draft.section !== 'title' && draft.section !== 'skills' && draft.language !== language),
  );
  const skipped = new Set(
    drafts.filter((draft) => draft.section !== 'title' && draft.section !== 'skills' && draft.language !== language && !foreign.includes(draft)),
  );
  const translate = translator?.translate?.bind(translator);
  const arrived = new Map<string, string>();
  if (foreign.length > 0 && translate) {
    const jobs = foreign.map((draft) =>
      translateLines(translate, linesOf(draft), language).then((pairs) => pairs.forEach(([key, text]) => arrived.set(key, text))),
    );
    const deadline = expiresIn(budgetMs);
    await Promise.race([Promise.all(jobs), deadline.promise]).finally(deadline.cancel);
  }
  return drafts.flatMap((draft) => {
    if (skipped.has(draft)) return [];
    if (!foreign.includes(draft)) return [publicEdit(draft, draft.now)];
    const lines = linesOf(draft).map((line) => arrived.get(line.key));
    return lines.every((line): line is string => Boolean(line)) ? [publicEdit(draft, lines.join('\n'))] : [];
  });
}
