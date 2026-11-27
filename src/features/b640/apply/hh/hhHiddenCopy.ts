import {
  HH_RESUMES_MAX,
  hhSectionsRead,
  type HhResumeContent,
  type HhResumeCopy,
  type HhResumeEdit,
  type HhResumeSummary,
} from '../../../../../shared/hhCandidateSession';
import type { HhResumeItem } from '../../../connections/hhSessionPoll';
import type { HhCopyReport, HhResumeEditInput, HhResumeEditReport, HhSessionRead } from './hhDesktop';
import { desktopFailureCode } from './hhSendModel';
import { canApply, editInput } from './useHhResumeApply';

/**
 * B787: резюме под вакансию. Копия выбранного резюме сразу скрывается от всех — это подтверждает
 * заново загруженная страница hh.ru — и только потом заполняется правками из подтверждённого профиля.
 * Не скрылась — копия удаляется. Начатое хранится за вакансией: повтор продолжает ту же копию.
 */
export interface HiddenCopyDeps {
  readonly readList: () => Promise<HhSessionRead>;
  readonly readContent: (item: HhResumeItem) => Promise<HhResumeContent>;
  readonly copy: (sourceId: string, knownIds: readonly string[]) => Promise<HhCopyReport>;
  readonly hide: (copyId: string, knownIds: readonly string[]) => Promise<HhCopyReport>;
  readonly remove: (copyId: string, knownIds: readonly string[]) => Promise<HhCopyReport>;
  readonly edit: (input: HhResumeEditInput) => Promise<HhResumeEditReport>;
  readonly saveCopy: (copy: HhResumeCopy | null) => Promise<unknown>;
  /** Сохраняет прочитанное и выбирает копию для вакансии. */
  readonly choose: (list: readonly HhResumeItem[], content: HhResumeContent) => Promise<unknown>;
  readonly edits: () => Promise<readonly HhResumeEdit[]>;
  readonly pause: () => Promise<void>;
}

export interface HiddenCopyInput {
  readonly source: HhResumeSummary;
  readonly vacancyTitle: string;
  readonly started?: HhResumeCopy | undefined;
}

export type HiddenCopyStep = { readonly kind: 'copying' } | { readonly kind: 'hiding' } | { readonly kind: 'filling'; readonly done: number; readonly total: number };
export type HiddenCopyResult = { readonly ok: true; readonly copyId: string } | { readonly ok: false; readonly code: string };

/** Заголовок карточки без названия в списке hh.ru. */
const UNTITLED = 'Резюме hh.ru';
const TITLE_MAX = 100;
/** Копии ещё нет: окно hh.ru до «Дублировать» не дошло. */
const BEFORE_COPY: ReadonlySet<string> = new Set([
  'limit_reached', 'not_signed_in', 'hh_busy', 'source_missing', 'source_ambiguous', 'menu_missing', 'menu_unexpected',
]);

class Stop extends Error {}

function stop(code: string): never {
  throw new Stop(code);
}

async function report(run: () => Promise<HhCopyReport>): Promise<HhCopyReport> {
  try {
    return await run();
  } catch (reason: unknown) {
    return { outcome: 'failed', failureCode: desktopFailureCode(reason) };
  }
}

async function listOf(deps: HiddenCopyDeps): Promise<readonly HhResumeItem[]> {
  const list = await deps.readList();
  if (list.kind === 'signed_out') return stop('not_signed_in');
  return list.kind === 'ready' ? list.resumes : [];
}

/** Появившееся после начала резюме — копия, если оно одно и называется как исходное. */
function appeared(list: readonly HhResumeItem[], started: HhResumeCopy, source: HhResumeSummary): string | null {
  const fresh = list.filter((item) => !started.knownIds.includes(item.id));
  if (fresh.length === 0) return null;
  const [only] = fresh;
  const named = only && (only.title === source.title || only.title === UNTITLED);
  return fresh.length === 1 && named ? only.id : stop('copy_ambiguous');
}

async function newCopy(deps: HiddenCopyDeps, source: HhResumeSummary, list: readonly HhResumeItem[]): Promise<HhResumeCopy> {
  if (!list.some((item) => item.id === source.id)) stop('source_missing');
  if (list.length >= HH_RESUMES_MAX) stop('limit_reached');
  const started: HhResumeCopy = { sourceId: source.id, knownIds: list.map((item) => item.id), stage: 'creating' };
  await deps.saveCopy(started);
  const made = await report(() => deps.copy(source.id, started.knownIds));
  const code = made.failureCode ?? 'copy_unconfirmed';
  if (made.outcome === 'copied' && made.copyId) return { ...started, copyId: made.copyId };
  // Нажатие могло дойти до hh.ru и при коде «до копии» (страница сменилась после нажатия):
  // копию ищем в списке, второй раз не нажимаем. Список не прочитался — начатое не забываем.
  const after = await listOf(deps).catch(() => null);
  const found = after ? appeared(after, started, source) : null;
  if (found) return { ...started, copyId: found };
  if (after && BEFORE_COPY.has(code)) await deps.saveCopy(null);
  return stop(code);
}

/** Копия, начатая раньше, или новая. */
async function ownCopy(deps: HiddenCopyDeps, { source, started }: HiddenCopyInput): Promise<HhResumeCopy> {
  if (started?.copyId) return started;
  const list = await listOf(deps);
  // Начатую копию ищем по её исходному резюме, даже если теперь выбрано другое.
  const origin = started ? (list.find((item) => item.id === started.sourceId) ?? source) : source;
  const found = started ? appeared(list, started, origin) : null;
  return found && started ? { ...started, copyId: found } : newCopy(deps, source, list);
}

type Owned = HhResumeCopy & { readonly copyId: string };

/** Не скрылась с двух попыток — копия удаляется; удалённой считается та, которой нет в списке. */
async function hidden(deps: HiddenCopyDeps, copy: Owned): Promise<void> {
  let code = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await report(() => deps.hide(copy.copyId, copy.knownIds));
    if (result.outcome === 'hidden') return;
    code = result.failureCode ?? 'visibility_unconfirmed';
    if (code === 'not_signed_in' || code === 'captcha') break;
  }
  await report(() => deps.remove(copy.copyId, copy.knownIds));
  const left = await listOf(deps).catch(() => null);
  // Пустой список после входа — это непрочитанный список, а не удалённая копия.
  if (!left || left.length === 0 || left.some((item) => item.id === copy.copyId)) {
    return stop(code === 'captcha' ? 'copy_left_captcha' : 'copy_left_visible');
  }
  await deps.saveCopy(null);
  return stop('copy_removed');
}

async function readCopy(deps: HiddenCopyDeps, copyId: string): Promise<HhResumeContent> {
  const list = await listOf(deps);
  const item = list.find((entry) => entry.id === copyId) ?? stop('copy_not_listed');
  const content = await deps.readContent(item);
  if (!hhSectionsRead(content.sections)) stop('copy_not_read');
  await deps.choose(list, content);
  return content;
}

/** На hh.ru у резюме разные должности: без своей правки копия берёт должность вакансии. */
function inputsFor(copyId: string, edits: readonly HhResumeEdit[], content: HhResumeContent, input: HiddenCopyInput): HhResumeEditInput[] {
  const ready = edits.filter(canApply).flatMap((edit) => editInput(copyId, edit) ?? []);
  const title = input.vacancyTitle.trim().slice(0, TITLE_MAX);
  const titled = ready.some((edit) => edit.section === 'title');
  const same = content.title.trim() === input.source.title.trim() && title !== content.title.trim();
  const own: HhResumeEditInput[] = !titled && same && title ? [{ resumeId: copyId, section: 'title', text: title, skills: [] }] : [];
  return [...own, ...ready.filter((edit) => edit.section === 'title'), ...ready.filter((edit) => edit.section !== 'title')];
}

async function fill(deps: HiddenCopyDeps, copy: Owned, input: HiddenCopyInput, onStep: (step: HiddenCopyStep) => void): Promise<void> {
  const content = await readCopy(deps, copy.copyId);
  const queue = inputsFor(copy.copyId, await deps.edits(), content, input);
  for (const [index, edit] of queue.entries()) {
    onStep({ kind: 'filling', done: index, total: queue.length });
    if (index > 0) await deps.pause();
    const result = await deps.edit(edit);
    if (result.outcome !== 'applied') stop(result.failureCode ?? 'edit_failed');
    // Сохранение должности hh.ru может опубликовать копию: видимость сверяется сразу.
    if (edit.section === 'title') await hidden(deps, copy);
  }
  onStep({ kind: 'filling', done: queue.length, total: queue.length });
  await hidden(deps, copy);
  await readCopy(deps, copy.copyId);
}

async function run(deps: HiddenCopyDeps, input: HiddenCopyInput, onStep: (step: HiddenCopyStep) => void): Promise<string> {
  onStep({ kind: 'copying' });
  const made = await ownCopy(deps, input);
  const copyId = made.copyId ?? stop('copy_unconfirmed');
  const copy: Owned = { ...made, copyId };
  onStep({ kind: 'hiding' });
  // Запись не удалась — копию всё равно скрываем: видимой она не остаётся.
  const [saved] = await Promise.allSettled([deps.saveCopy(copy)]);
  await hidden(deps, copy);
  if (saved.status === 'rejected') throw saved.reason;
  await deps.saveCopy({ ...copy, stage: 'hidden' });
  await fill(deps, copy, input, onStep);
  await deps.saveCopy({ ...copy, stage: 'ready' });
  return copyId;
}

export async function createHiddenCopy(
  deps: HiddenCopyDeps,
  input: HiddenCopyInput,
  onStep: (step: HiddenCopyStep) => void,
): Promise<HiddenCopyResult> {
  try {
    return { ok: true, copyId: await run(deps, input, onStep) };
  } catch (reason: unknown) {
    return { ok: false, code: reason instanceof Stop ? reason.message : desktopFailureCode(reason) };
  }
}
