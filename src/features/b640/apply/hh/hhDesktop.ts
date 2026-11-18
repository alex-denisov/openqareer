import {
  HH_RESUME_ID,
  HH_RESUME_TEXT_MAX_LENGTH,
  HH_RESUME_TITLE_MAX_LENGTH,
  HH_RESUMES_MAX,
  type HhApplyOutcome,
  type HhResumeContent,
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

/** Содержимое выбранного резюме — страница резюме в сессии кандидата, как её показывает hh.ru. */
export async function readHhResumeContent(item: HhResumeItem): Promise<HhResumeContent> {
  const parsed = await readHhResumeFromSession(item.url, (url) => readSessionPage('hh', url));
  const text = parsed?.rawText.trim();
  if (!text) throw new Error('hh_resume_not_read');
  return {
    id: item.id,
    title: item.title.trim().slice(0, HH_RESUME_TITLE_MAX_LENGTH),
    text: text.slice(0, HH_RESUME_TEXT_MAX_LENGTH),
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
