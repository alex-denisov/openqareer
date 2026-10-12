import type { CareerDiaryAchievement } from '../../../shared/careerDiary';
import type { CoachResult } from '../coach/coachApi';

export function buildCareerDiaryAchievementPrompt(achievement: CareerDiaryAchievement): string {
  return [
    'Источник: карьерный дневник, запись ' + achievement.id + ' от ' + achievement.createdAt.slice(0, 10) + '.',
    'Ситуация: ' + achievement.situation,
    'Действие: ' + achievement.action,
    'Результат: ' + achievement.result,
    'Предложите проверяемую правку существующего раздела профиля только на основании этой записи и укажите её источник. Не добавляйте неподтверждённые факты. Если подходящего раздела нет, не предлагайте правку.',
  ].join('\n');
}

export function careerDiaryProfileProposals(
  result: CoachResult,
  messageId: string,
): Array<{ readonly proposal: CoachResult['actionProposals'][number]; readonly index: number }> {
  return result.actionProposals.flatMap((proposal, index) =>
    proposal.kind === 'resume.revise' &&
    proposal.risk === 'candidate_data_write' &&
    proposal.resumeRevision &&
    proposal.evidenceRefs.includes(messageId)
      ? [{ proposal, index }]
      : [],
  );
}
