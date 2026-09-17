import type { VacancyApplication } from '../../../shared/vacancyApplication';

export type FollowUpStage = 'none' | 'day_5' | 'day_8' | 'stale';

export interface FollowUpMessageInput {
  readonly vacancyTitle: string;
  readonly companyName: string;
  readonly candidateName?: string;
  readonly stage: 'day_5' | 'day_8' | FollowUpStage;
}

export interface PendingFollowUp {
  readonly application: VacancyApplication;
  readonly stage: 'day_5' | 'day_8';
  readonly daysSinceApplied: number;
  readonly message: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function getDaysSince(dateIso: string | null, now?: Date): number | null {
  if (!dateIso) return null;
  const targetDate = new Date(dateIso);
  if (isNaN(targetDate.getTime())) return null;
  const currentDate = now ?? new Date();
  const diffMs = currentDate.getTime() - targetDate.getTime();
  if (diffMs < 0) return null;
  return Math.floor(diffMs / MS_PER_DAY);
}

export function calculateFollowUpStage(
  appliedAt: string | null,
  now?: Date,
): FollowUpStage {
  const diffDays = getDaysSince(appliedAt, now);
  if (diffDays === null || diffDays < 5) return 'none';
  if (diffDays <= 7) return 'day_5';
  if (diffDays <= 10) return 'day_8';
  return 'stale';
}

function buildDay5Message(
  title: string,
  company: string,
  candidate?: string,
): string {
  const intro = `Здравствуйте! Несколько дней назад я откликался на вакансию «${title}» в компании ${company}.`;
  const body =
    'Хотел деликатно уточнить, удалось ли вашей команде ознакомиться с откликом и на каком этапе сейчас рассмотрение кандидатов.';
  const footer =
    'Мой опыт и подтверждённые навыки точно соответствуют задачам роли, и я с радостью отвечу на любые вопросы.';
  const sign = candidate ? `\n\nС уважением,\n${candidate}` : '';
  return `${intro} ${body} ${footer}${sign}`;
}

function buildDay8Message(
  title: string,
  company: string,
  candidate?: string,
): string {
  const intro = `Здравствуйте! Хочу уточнить статус своего отклика на позицию «${title}» в ${company}.`;
  const body =
    'Понимаю высокую загрузку команды найма, поэтому пишу лишь узнать, остаётся ли вакансия открытой и в силе ли рассмотрение моей кандидатуры.';
  const footer =
    'Если процесс ещё идёт, я готов предоставить любые дополнительные материалы. Если же позиция закрыта или приоритеты сменились, буду благодарен за короткий ответ.';
  const sign = candidate ? `\n\nС уважением,\n${candidate}` : '';
  return `${intro} ${body} ${footer}${sign}`;
}

export function generateFollowUpMessage(input: FollowUpMessageInput): string {
  const { vacancyTitle, companyName, candidateName, stage } = input;
  if (stage === 'day_8') {
    return buildDay8Message(vacancyTitle, companyName, candidateName);
  }
  return buildDay5Message(vacancyTitle, companyName, candidateName);
}

export function findPendingFollowUps(
  applications: readonly VacancyApplication[],
  now?: Date,
): readonly PendingFollowUp[] {
  const pending: PendingFollowUp[] = [];
  for (const application of applications) {
    if (application.status !== 'applied' || !application.appliedAt) {
      continue;
    }
    const stage = calculateFollowUpStage(application.appliedAt, now);
    if (stage === 'day_5' || stage === 'day_8') {
      const days = getDaysSince(application.appliedAt, now) ?? 0;
      pending.push({
        application,
        stage,
        daysSinceApplied: days,
        message: generateFollowUpMessage({
          vacancyTitle: application.vacancy.title,
          companyName: application.vacancy.company,
          stage,
        }),
      });
    }
  }
  return pending;
}
