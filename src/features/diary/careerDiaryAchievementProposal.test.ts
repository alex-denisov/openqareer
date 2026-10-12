import { describe, expect, it } from 'vitest';
import type { CareerDiaryAchievement } from '../../../shared/careerDiary';
import type { CoachResult } from '../coach/coachApi';
import {
  buildCareerDiaryAchievementPrompt,
  careerDiaryProfileProposals,
} from './careerDiaryAchievementProposal';

const achievement: CareerDiaryAchievement = {
  id: 'achievement-1',
  situation: 'Не хватало данных по бюджету.',
  action: 'Подготовил и согласовал расчёт.',
  result: 'Бюджет утверждён на три позиции.',
  status: 'ready_to_add',
  createdAt: '2026-10-08T09:00:00.000Z',
  updatedAt: '2026-10-08T09:00:00.000Z',
};

const proposal = (evidenceRefs: string[], kind: CoachResult['actionProposals'][number]['kind'] = 'resume.revise') => ({
  kind,
  objective: 'Добавить достижение из дневника в профиль.',
  evidenceRefs,
  acceptanceCriteria: ['Текст подтверждён кандидатом.'],
  expectedSignal: 'Профиль содержит достижение.',
  measureAfter: '2026-12-31',
  risk: 'candidate_data_write' as const,
  resumeRevision: {
    section: 'about' as const,
    experienceId: null,
    memoryId: null,
    proposedText: 'Бюджет утверждён на три позиции. Источник: карьерный дневник.',
  },
});

const result = (actionProposals: CoachResult['actionProposals']): CoachResult => ({
  message: 'Предлагаю добавить подтверждённый результат в профиль.',
  phase: 'resume',
  nextQuestion: null,
  completeness: { known: [], unknown: [] },
  safety: { needsHuman: false, reason: null },
  careerTrack: null,
  actionProposals,
});

describe('career diary achievement proposal', () => {
  it('sends only the saved diary evidence and asks for a reviewable profile proposal', () => {
    const content = buildCareerDiaryAchievementPrompt(achievement);

    expect(content).toContain('Источник: карьерный дневник');
    expect(content).toContain(achievement.situation);
    expect(content).toContain(achievement.action);
    expect(content).toContain(achievement.result);
    expect(content).toContain('Не добавляйте неподтверждённые факты');
  });

  it('keeps only profile revisions that cite this diary turn', () => {
    const messageId = 'diary:achievement-1:turn-1';
    const coachResult = result([
      proposal([messageId]),
      proposal(['resume:unrelated']),
      proposal([messageId], 'vacancies.search'),
    ]);

    expect(careerDiaryProfileProposals(coachResult, messageId)).toEqual([
      { proposal: coachResult.actionProposals[0], index: 0 },
    ]);
  });
});
