import type { TodayDigest, TodayFollowUp, TodayNewVacanciesCaption, TodayNextInterview } from './todayApi';

/**
 * Подписи-обоснования под числом на плитке дайджеста (макет
 * B248/today.html): «кампания X · обновлено в 09:14», перечень
 * follow-up-причин, «Компания · раунд N · пятница, 14:00». Вынесено из
 * `TodayScreen.tsx`, чтобы форматирование дат и склейку строк можно было
 * проверить отдельно от вёрстки.
 */

function formatHm(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

function formatWeekdayTime(iso: string): string {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(date);
  return `${weekday}, ${formatHm(iso)}`;
}

export function newVacanciesBasis(caption: TodayNewVacanciesCaption | null): string | null {
  if (!caption) return null;
  const campaign = caption.campaignRole ? `кампания ${caption.campaignRole}` : null;
  const updated = caption.updatedAt ? `обновлено в ${formatHm(caption.updatedAt)}` : null;
  return [campaign, updated].filter(Boolean).join(' · ') || null;
}

export function followUpBasis(captions: readonly string[]): string | null {
  return captions.length > 0 ? captions.join(' · ') : null;
}

export function nextInterviewBasis(interview: TodayNextInterview | null): string | null {
  if (!interview) return null;
  const who = interview.company ?? interview.title;
  return `${who} · раунд ${interview.round} · ${formatWeekdayTime(interview.at)}`;
}

export function digestBasis(kind: 'new' | 'followUp' | 'interview', digest: TodayDigest): string | null {
  if (kind === 'new') return newVacanciesBasis(digest.newVacanciesCaption);
  if (kind === 'followUp') return followUpBasis(digest.followUpCaptions);
  return nextInterviewBasis(digest.nextInterview);
}

const FOLLOW_UP_STATUS_LABEL: Record<TodayFollowUp['status'], string> = {
  today: 'сегодня',
  overdue: 'просрочен',
  sent: 'отправлен',
};

export function followUpStatusLabel(status: TodayFollowUp['status']): string {
  return FOLLOW_UP_STATUS_LABEL[status];
}

export function companyInitials(company: string | null): string {
  if (!company) return '—';
  const letters = company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return letters || '—';
}
