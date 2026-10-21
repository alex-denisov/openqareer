import { pluralRu, pluralWordRu } from '../../../shared/pluralRu';
import type { TodayTeamSizeDecision } from '../today/todayApi';
import type { ReasonedCareerAction } from './careerActionPolicy';

const TEAM_SIZE_ACTION_REVISION = 'career-action-policy-v1-2026-08-07' as const;

function favoritesShare(asking: number, total: number): string {
  const favorites = pluralWordRu(total, [
    'избранной вакансии',
    'избранных вакансий',
    'избранных вакансий',
  ]);
  const verb = pluralWordRu(asking, ['просит', 'просят', 'просят']);
  return `${asking} из ${total} ${favorites} ${verb}`;
}

function readAtLabel(readAt: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(readAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')}.${part('month')} ${part('hour')}:${part('minute')}`;
}

/** B540, mockup 1: the team size decision, every number taken from the server's decision. */
export function buildTeamSizeAction(
  decision: TodayTeamSizeDecision,
  timeZone: string,
): ReasonedCareerAction {
  const firstReason = 'В профиле размер команды «неизвестно». От него зависит оценка уровня.';
  const asking = `${favoritesShare(decision.favoritesAsking, decision.favoritesTotal)} управлять от ${pluralRu(decision.minTeamSize, ['человека', 'человек', 'человек'])}`;
  const consequence = 'без этого факта совпадение по уровню не считается.';
  return {
    revision: TEAM_SIZE_ACTION_REVISION,
    type: 'review',
    destination: 'coach',
    headline: `Подтвердите размер команды в «${decision.employer}»`,
    label: 'Подтвердить факт',
    rationale: firstReason,
    reasons: [
      { text: firstReason, link: { label: 'Профиль, Опыт', target: 'profile-experience' } },
      {
        text: `${asking}; ${consequence}`,
        mobileText: `${asking}. Без этого факта совпадение по уровню не считается.`,
        link: { label: 'Избранное', target: 'favorites' },
      },
    ],
    expectedChange: `Откроется оценка уровня для ${pluralRu(decision.favoritesAsking, ['вакансии', 'вакансий', 'вакансий'])}. Около 2 минут.`,
    sourcesLabel: `профиль и избранное, ${readAtLabel(decision.readAt, timeZone)}`,
    profileFocus: {
      section: 'experience',
      experienceId: decision.experienceId,
      employer: decision.employer,
      ...(decision.title ? { title: decision.title } : {}),
    },
    findingIds: [`team-size:${decision.experienceId}`],
    roleIds: [],
    marketIds: [],
    alternatives: [],
    approvalBoundary: 'Размер команды меняется только после вашего подтверждения.',
  };
}

/** The server's team size decision outranks the diagnostic's generic one when it exists. */
export function todayDecisionAction(
  decision: TodayTeamSizeDecision | undefined,
  fallback: ReasonedCareerAction | undefined,
): ReasonedCareerAction | undefined {
  if (!decision) return fallback;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return buildTeamSizeAction(decision, timeZone);
}
