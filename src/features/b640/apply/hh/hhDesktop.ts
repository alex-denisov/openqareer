import { hhResumesListReport } from '../../../../services/connectors/hhResumesListReport';
import { hhResumeMarkupSketch } from '../../../../services/connectors/hhResumeMarkupSketch';
import {
  HH_RESUME_ID,
  HH_RESUME_TEXT_MAX_LENGTH,
  HH_RESUME_TITLE_MAX_LENGTH,
  HH_RESUMES_MAX,
  HH_SECTION_PLACES_MAX,
  HH_SECTION_SKILLS_MAX,
  HH_SECTION_TEXT_MAX_LENGTH,
  type HhApplyOutcome,
  type HhConsent,
  type HhForm,
  type HhFormAnswer,
  type HhResumeContent,
  type HhResumeSections,
  type HhResumeSummary,
} from '../../../../../shared/hhCandidateSession';
import { inspectSessionPage, readSessionPage } from '../../../connections/connectorSession';
import {
  createHhSessionPoller,
  readHhResumeFromSession,
  type HhResumeItem,
} from '../../../connections/hhSessionPoll';
import { invokeDesktopCommand } from '../../../../services/desktop/desktopBridge';
import { reportHhAlive } from './hhAlive';
import { hideHhWindow } from './hhPersonWindow';
import { ensureHhWindow, ensureSettledHhWindow } from './hhWindow';
export { openHhSignIn, showHhCaptcha, showHhResponse, signInToHh } from './hhPersonWindow';
import type { ParsedResume } from '../../../workspace/resumeParserTypes';

/**
 * B704: сессия кандидата hh.ru в настольном приложении. Кандидат входит сам, в окне hh.ru;
 * список резюме и содержимое выбранного читаются в этом окне, отклик уходит там же.
 */
export type HhSessionRead =
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly resumes: readonly HhResumeItem[] };

export interface HhDesktopReport {
  readonly outcome: HhApplyOutcome;
  readonly failureCode?: string | null;
  /** B641: анкета работодателя, если hh.ru её показал. */
  readonly questionnaire?: HhForm | null;
  /** Галочки согласия, поставленные по поручению. */
  readonly consents?: readonly HhConsent[];
}

/** hh.ru просит проверку: её проходит кандидат в окне hh.ru. */
export const HH_CAPTCHA = 'hh_captcha';

/** B787: локальный файл диагностики; ни сбор, ни запись чтению не мешают. */
function writeDiagnosticFile(command: string, args: () => Record<string, unknown>): void {
  void Promise.resolve()
    .then(() => invokeDesktopCommand<void>(command, args()))
    .catch(() => undefined);
}

/** B787: список резюме — в локальный файл диагностики; сбой записи чтению не мешает. */
function saveResumesList(body: string): void {
  writeDiagnosticFile('write_hh_resumes_list', () => ({ report: hhResumesListReport(body) }));
}

const poller = createHhSessionPoller({
  inspectCurrentPage: () => inspectSessionPage('hh'),
  readSessionPage: (url) => readSessionPage('hh', url),
  onResumeList: saveResumesList,
});

/** Список резюме кандидата в его сессии hh.ru; «нужен вход» — только когда его показывает сама страница. */
export async function readHhResumes(): Promise<HhSessionRead> {
  if ((await ensureSettledHhWindow()) === 'signed_out') return { kind: 'signed_out' };
  const result = await poller.poll();
  // Вход только что виден, а страница ушла или просит проверку: это сбой чтения, а не вход.
  if (result.status === 'waiting_for_sign_in') {
    const page = await inspectSessionPage('hh').catch(() => null);
    throw new Error(page?.captcha ? HH_CAPTCHA : 'hh_resumes_not_read');
  }
  await reportHhAlive();
  if (result.status === 'authenticated_empty') return { kind: 'empty' };
  const usable = result.resumes.filter((item) => HH_RESUME_ID.test(item.id) && item.title.trim());
  return usable.length > 0
    ? { kind: 'ready', resumes: usable.slice(0, HH_RESUMES_MAX) }
    : { kind: 'empty' };
}

const clip = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max);

/** B678: разделы резюме, которые платформа предлагает поправить, — из разобранной страницы hh.ru. */
export function sectionsOf(parsed: ParsedResume, fallbackTitle: string): HhResumeSections {
  return {
    title: clip(parsed.targetRole || fallbackTitle, HH_RESUME_TITLE_MAX_LENGTH),
    about: clip(parsed.about, HH_SECTION_TEXT_MAX_LENGTH),
    aboutRead: parsed.about !== undefined,
    skills: parsed.skills
      .map((skill) => clip(skill, 200))
      .filter(Boolean)
      .slice(0, HH_SECTION_SKILLS_MAX),
    places: parsed.experience.slice(0, HH_SECTION_PLACES_MAX).map((place) => ({
      employer: clip(place.employer, 300),
      title: clip(place.title, 300),
      period: clip(
        [place.startDate, place.current ? 'по настоящее время' : place.endDate]
          .filter(Boolean)
          .join(' — '),
        120,
      ),
      text: clip(
        [...place.responsibilities, ...place.achievements].join('\n'),
        HH_SECTION_TEXT_MAX_LENGTH,
      ),
    })),
  };
}

/** B787: набросок разметки опыта — в локальный файл диагностики; сбой записи чтению не мешает. */
function saveMarkupSketch(body: string): void {
  writeDiagnosticFile('write_hh_resume_markup', () => ({ sketch: hhResumeMarkupSketch(body) }));
}

/** Содержимое выбранного резюме — страница резюме в сессии кандидата, как её показывает hh.ru. */
export async function readHhResumeContent(item: HhResumeItem): Promise<HhResumeContent> {
  if ((await ensureHhWindow()) === 'signed_out') throw new Error('hh_resume_not_read');
  const parsed = await readHhResumeFromSession(
    item.url,
    (url) => readSessionPage('hh', url),
    saveMarkupSketch,
  );
  const text = parsed?.rawText.trim();
  if (!parsed || !text) throw new Error('hh_resume_not_read');
  const title = item.title.trim().slice(0, HH_RESUME_TITLE_MAX_LENGTH);
  return {
    id: item.id,
    title,
    text: text.slice(0, HH_RESUME_TEXT_MAX_LENGTH),
    sections: sectionsOf(parsed, title),
  };
}

export function summaryOf(item: HhResumeItem): HhResumeSummary {
  const updated = item.updatedLabel?.trim();
  return {
    id: item.id,
    title: item.title.trim().slice(0, HH_RESUME_TITLE_MAX_LENGTH),
    ...(updated ? { updatedLabel: updated.slice(0, 120) } : {}),
  };
}

/** Отклик в окне hh.ru кандидата. Вызывается только после его подтверждения. */
export async function runHhApplyInSession(input: {
  readonly vacancyId: string;
  readonly resumeId: string;
  readonly letter: string;
  /** Заголовок резюме, если он у кандидата один: запасной признак, когда hh.ru не отдал идентификатор. */
  readonly uniqueResumeTitle?: string;
  /** Подтверждённые ответы анкеты. */
  readonly answers?: readonly HhFormAnswer[];
  readonly consent?: boolean;
  readonly agreedRelocation?: boolean;
  readonly agreedVisibility?: boolean;
}): Promise<HhDesktopReport> {
  if ((await ensureHhWindow()) === 'signed_out')
    return { outcome: 'failed', failureCode: 'not_signed_in' };
  await hideHhWindow();
  const report = await invokeDesktopCommand<HhDesktopReport>('run_hh_apply', { request: input });
  if (!report) throw new Error('desktop_unavailable');
  return report;
}

/** B708: виден ли в окне hh.ru отклик на эту вакансию. Только чтение открытой страницы. */
export async function readHhApplyWindow(vacancyId: string): Promise<'sent' | 'waiting'> {
  const code = await invokeDesktopCommand<string>('read_hh_apply_window', { vacancyId });
  if (code !== 'sent' && code !== 'waiting') throw new Error('desktop_unavailable');
  return code;
}

export interface HhSectionEditInput {
  readonly resumeId: string;
  readonly section: 'title' | 'skills' | 'about';
  readonly text: string;
  readonly skills: readonly string[];
}

/** B678, срез 4: место работы — новым местом с галочкой только этого резюме. */
export interface HhExperienceEditInput {
  readonly resumeId: string;
  readonly section: 'experience';
  readonly employer: string;
  readonly position: string;
  readonly was: string;
  readonly text: string;
}

export type HhResumeEditInput = HhSectionEditInput | HhExperienceEditInput;

export interface HhResumeEditReport {
  readonly outcome: 'applied' | 'failed';
  readonly failureCode?: string | null;
}

/** B678: раздел резюме hh.ru в окне кандидата. Вызывается только после его «Применить». */
export async function applyHhResumeEditInSession(
  input: HhResumeEditInput,
): Promise<HhResumeEditReport> {
  if ((await ensureHhWindow()) === 'signed_out')
    return { outcome: 'failed', failureCode: 'not_signed_in' };
  await hideHhWindow();
  const report =
    input.section === 'experience'
      ? await invokeDesktopCommand<HhResumeEditReport>('run_hh_experience_edit', {
          request: {
            resumeId: input.resumeId,
            employer: input.employer,
            position: input.position,
            was: input.was,
            text: input.text,
          },
        })
      : await invokeDesktopCommand<HhResumeEditReport>('run_hh_resume_edit', { request: input });
  if (!report) throw new Error('desktop_unavailable');
  return report;
}

export interface HhCopyReport {
  readonly outcome: 'copied' | 'hidden' | 'deleted' | 'failed';
  readonly copyId?: string | null;
  readonly failureCode?: string | null;
}

async function copyCommand(
  command: string,
  request: Record<string, unknown>,
): Promise<HhCopyReport> {
  if ((await ensureHhWindow()) === 'signed_out')
    return { outcome: 'failed', failureCode: 'not_signed_in' };
  await hideHhWindow();
  const report = await invokeDesktopCommand<HhCopyReport>(command, { request });
  if (!report) throw new Error('desktop_unavailable');
  return report;
}

/** B787: копия резюме в окне кандидата. Вызывается только после «Создать резюме под вакансию». */
export const copyHhResume = (sourceId: string, knownIds: readonly string[]) =>
  copyCommand('run_hh_resume_copy', { sourceId, knownIds });

/** Копия не видна никому: подтверждено страницей hh.ru, загруженной заново. */
export const hideHhCopy = (copyId: string, knownIds: readonly string[]) =>
  copyCommand('run_hh_resume_hide', { copyId, knownIds });

export const deleteHhCopy = (copyId: string, knownIds: readonly string[]) =>
  copyCommand('run_hh_resume_delete_copy', { copyId, knownIds });
