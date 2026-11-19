import {
  HH_RESUME_ID,
  HH_RESUME_TEXT_MAX_LENGTH,
  HH_RESUME_TITLE_MAX_LENGTH,
  HH_RESUMES_MAX,
  HH_SECTION_PLACES_MAX,
  HH_SECTION_SKILLS_MAX,
  HH_SECTION_TEXT_MAX_LENGTH,
  type HhApplyOutcome,
  type HhResumeContent,
  type HhResumeSections,
  type HhResumeSummary,
} from '../../../../../shared/hhCandidateSession';
import {
  inspectSessionPage,
  openConnectorSession,
  readSessionPage,
} from '../../../connections/connectorSession';
import {
  createHhSessionPoller,
  readHhResumeFromSession,
  type HhResumeItem,
} from '../../../connections/hhSessionPoll';
import { invokeDesktopCommand } from '../../../../services/desktop/desktopBridge';
import type { ParsedResume } from '../../../workspace/resumeParserTypes';

/**
 * B704: сессия кандидата hh.ru в настольном приложении. Кандидат входит сам, в окне hh.ru;
 * список резюме и содержимое выбранного читаются в этом окне, отклик уходит там же.
 */
const HH_LOGIN_URL = 'https://hh.ru/account/login';

export type HhSessionRead =
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly resumes: readonly HhResumeItem[] };

export interface HhDesktopReport {
  readonly outcome: HhApplyOutcome;
  readonly failureCode?: string | null;
}

/** Открывает окно входа hh.ru; вошедшего кандидата hh.ru сам ведёт дальше. */
export async function openHhSignIn(): Promise<boolean> {
  return (await openConnectorSession('hh', HH_LOGIN_URL)).opened;
}

const poller = createHhSessionPoller({
  inspectCurrentPage: () => inspectSessionPage('hh'),
  readSessionPage: (url) => readSessionPage('hh', url),
});

/**
 * Окна сессии hh.ru нет: кандидат ещё не входил в приложении или закрыл окно. Rust отвечает
 * отказом `session_window_missing` — это «нужен вход», а не сбой чтения.
 */
function isMissingSessionWindow(reason: unknown): boolean {
  const raw = reason instanceof Error ? reason.message : String(reason ?? '');
  return raw.split(':')[0]?.trim() === 'session_window_missing';
}

/** Список резюме кандидата в его сессии hh.ru. */
export async function readHhResumes(): Promise<HhSessionRead> {
  let result: Awaited<ReturnType<typeof poller.poll>>;
  try {
    result = await poller.poll();
  } catch (reason: unknown) {
    if (isMissingSessionWindow(reason)) return { kind: 'signed_out' };
    throw reason;
  }
  if (result.status === 'waiting_for_sign_in') return { kind: 'signed_out' };
  if (result.status === 'authenticated_empty') return { kind: 'empty' };
  const usable = result.resumes.filter((item) => HH_RESUME_ID.test(item.id) && item.title.trim());
  return usable.length > 0 ? { kind: 'ready', resumes: usable.slice(0, HH_RESUMES_MAX) } : { kind: 'empty' };
}

const clip = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max);

/** B678: разделы резюме, которые платформа предлагает поправить, — из разобранной страницы hh.ru. */
export function sectionsOf(parsed: ParsedResume, fallbackTitle: string): HhResumeSections {
  return {
    title: clip(parsed.targetRole || fallbackTitle, HH_RESUME_TITLE_MAX_LENGTH),
    about: clip(parsed.about, HH_SECTION_TEXT_MAX_LENGTH),
    skills: parsed.skills.map((skill) => clip(skill, 200)).filter(Boolean).slice(0, HH_SECTION_SKILLS_MAX),
    places: parsed.experience.slice(0, HH_SECTION_PLACES_MAX).map((place) => ({
      employer: clip(place.employer, 300),
      title: clip(place.title, 300),
      period: clip([place.startDate, place.current ? 'по настоящее время' : place.endDate].filter(Boolean).join(' — '), 120),
      text: clip([...place.responsibilities, ...place.achievements].join('\n'), HH_SECTION_TEXT_MAX_LENGTH),
    })),
  };
}

/** Содержимое выбранного резюме — страница резюме в сессии кандидата, как её показывает hh.ru. */
export async function readHhResumeContent(item: HhResumeItem): Promise<HhResumeContent> {
  const parsed = await readHhResumeFromSession(item.url, (url) => readSessionPage('hh', url));
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
}): Promise<HhDesktopReport> {
  const report = await invokeDesktopCommand<HhDesktopReport>('run_hh_apply', { request: input });
  if (!report) throw new Error('desktop_unavailable');
  return report;
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
export async function applyHhResumeEditInSession(input: HhResumeEditInput): Promise<HhResumeEditReport> {
  const report =
    input.section === 'experience'
      ? await invokeDesktopCommand<HhResumeEditReport>('run_hh_experience_edit', {
          request: { resumeId: input.resumeId, employer: input.employer, position: input.position, was: input.was, text: input.text },
        })
      : await invokeDesktopCommand<HhResumeEditReport>('run_hh_resume_edit', { request: input });
  if (!report) throw new Error('desktop_unavailable');
  return report;
}
