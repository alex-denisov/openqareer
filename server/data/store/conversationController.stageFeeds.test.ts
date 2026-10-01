import { describe, expect, it } from 'vitest';
import { createCandidate, createStore, output } from '../sqliteTestHarness';
import type { CoachProviderResult } from '../../providers/coachProvider';
import { computeProposalKey } from '../../../shared/consultantProposalKey';

const mockOutput: CoachProviderResult = output;

describe('conversationController stage feeds and rejections (B340 S1)', () => {
  it('isolates stage message feeds: profile messages do not leak into vacancies', () => {
    const store = createStore();
    const candidate = createCandidate(store);

    // 1. Turn in profile stage
    const profileKey = '51df5f57-df61-4ac2-98af-202610010001';
    store.startTurn(candidate.id, profileKey, {
      messageId: '51df5f57-df61-4ac2-98af-202610010002',
      content: 'Вопрос по резюме и опыту',
      phase: 'resume',
      stage: 'profile',
    });
    store.completeTurn(candidate.id, profileKey, mockOutput);

    // 2. Start turn in vacancies stage
    const vacanciesKey = '51df5f57-df61-4ac2-98af-202610010003';
    const turnVacancies = store.startTurn(candidate.id, vacanciesKey, {
      messageId: '51df5f57-df61-4ac2-98af-202610010004',
      content: 'Вопрос по вакансии',
      phase: 'market',
      stage: 'vacancies',
    });

    if (turnVacancies.state !== 'ready') throw new Error('expected ready turn');
    // Model turns should ONLY contain the current user message for vacancies stage, NOT the profile messages!
    expect(turnVacancies.input.messages).toHaveLength(1);
    expect(turnVacancies.input.messages[0].content).toBe('Вопрос по вакансии');

    // 3. Check snapshot messages by stage
    const profileSnapshot = store.getSnapshot(candidate.id, 'profile');
    expect(profileSnapshot.messages.map((m) => m.content)).toContain('Вопрос по резюме и опыту');
    expect(profileSnapshot.messages.map((m) => m.content)).not.toContain('Вопрос по вакансии');

    const vacanciesSnapshot = store.getSnapshot(candidate.id, 'vacancies');
    expect(vacanciesSnapshot.messages.map((m) => m.content)).toContain('Вопрос по вакансии');
    expect(vacanciesSnapshot.messages.map((m) => m.content)).not.toContain('Вопрос по резюме и опыту');

    // 4. Legacy client without stage sees all messages
    const legacySnapshot = store.getSnapshot(candidate.id);
    expect(legacySnapshot.messages.length).toBeGreaterThanOrEqual(3);
  });

  it('preserves legacy messages in the today stage feed', () => {
    const store = createStore();
    const candidate = createCandidate(store);

    // Old client turn without stage
    const oldKey = '51df5f57-df61-4ac2-98af-202610010010';
    store.startTurn(candidate.id, oldKey, {
      messageId: '51df5f57-df61-4ac2-98af-202610010011',
      content: 'Старое сообщение без этапа',
      phase: 'discovery',
    });
    store.completeTurn(candidate.id, oldKey, {
      ...mockOutput,
      result: { ...mockOutput.result, message: 'Старый ответ без этапа' },
    });

    // Today feed contains legacy messages
    const todaySnapshot = store.getSnapshot(candidate.id, 'today');
    expect(todaySnapshot.messages.map((m) => m.content)).toContain('Старое сообщение без этапа');
    expect(todaySnapshot.messages.map((m) => m.content)).toContain('Старый ответ без этапа');

    // Profile feed does NOT contain legacy messages
    const profileSnapshot = store.getSnapshot(candidate.id, 'profile');
    expect(profileSnapshot.messages).toHaveLength(0);
  });

  it('does not save service request prompts as candidate messages', () => {
    const store = createStore();
    const candidate = createCandidate(store);

    const serviceKey = '51df5f57-df61-4ac2-98af-202610010020';
    const turn = store.startTurn(candidate.id, serviceKey, {
      messageId: '51df5f57-df61-4ac2-98af-202610010021',
      content: 'Служебный промпт помощника требований',
      phase: 'market',
      stage: 'vacancies',
      isService: true,
    });
    store.completeTurn(candidate.id, serviceKey, mockOutput);

    if (turn.state !== 'ready') throw new Error('expected ready turn');
    const vacanciesSnapshot = store.getSnapshot(candidate.id, 'vacancies');
    expect(vacanciesSnapshot.messages.map((m) => m.content)).not.toContain(
      'Служебный промпт помощника требований',
    );
    expect(vacanciesSnapshot.messages.map((m) => m.content)).not.toContain(
      'Ответ консультанта по профилю',
    );
  });

  it('stores consultant rejections, excludes them from completed turn, and provides to model input', () => {
    const store = createStore();
    const candidate = createCandidate(store);

    const key = computeProposalKey('headline', 'VP of Engineering');
    store.rejectConsultantProposal(candidate.id, key, 'Не подходит по уровню');

    // Verify stored
    const rejections = store.getConsultantRejections(candidate.id);
    expect(rejections).toHaveLength(1);
    expect(rejections[0].proposalKey).toBe(key);
    expect(rejections[0].reason).toBe('Не подходит по уровню');

    // Start turn receives rejection string in input
    const turnKey = '51df5f57-df61-4ac2-98af-202610010030';
    const started = store.startTurn(candidate.id, turnKey, {
      messageId: '51df5f57-df61-4ac2-98af-202610010031',
      content: 'Что поправить в резюме?',
      phase: 'resume',
      stage: 'profile',
    });
    if (started.state !== 'ready') throw new Error('expected ready turn');
    expect(started.input.rejectedProposals).toEqual([
      'Отклонено: headline — Не подходит по уровню',
    ]);

    // Complete turn filters out the rejected proposal
    const outputWithProposal: CoachProviderResult = {
      ...mockOutput,
      result: {
        ...mockOutput.result,
        actionProposals: [
          {
            kind: 'resume.revise',
            objective: 'Обновить заголовок',
            evidenceRefs: ['msg-1'],
            acceptanceCriteria: ['Указана роль'],
            expectedSignal: 'Сигнал',
            measureAfter: '2026-10-15',
            risk: 'candidate_data_write',
            resumeRevision: {
              section: 'headline',
              experienceId: null,
              memoryId: null,
              proposedText: 'VP of Engineering',
            },
          },
          {
            kind: 'resume.revise',
            objective: 'Обновить о себе',
            evidenceRefs: ['msg-1'],
            acceptanceCriteria: ['Указан масштаб'],
            expectedSignal: 'Сигнал 2',
            measureAfter: '2026-10-15',
            risk: 'candidate_data_write',
            resumeRevision: {
              section: 'about',
              experienceId: null,
              memoryId: null,
              proposedText: '10+ лет управления',
            },
          },
        ],
      },
    };

    store.completeTurn(candidate.id, turnKey, outputWithProposal);
    const completedTurn = store.getCoachTurn(candidate.id, turnKey);
    // Rejected proposal (headline) must be filtered out! Only about remains.
    expect(completedTurn?.result?.actionProposals).toHaveLength(1);
    expect(completedTurn?.result?.actionProposals[0].resumeRevision?.section).toBe('about');
  });
});
