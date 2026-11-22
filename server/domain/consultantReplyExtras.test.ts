import { describe, expect, it } from 'vitest';
import { replyExtrasOf, type ReplyMemory } from './consultantReplyExtras';
import type { CoachTurnResult } from './coach';

const memory: ReplyMemory[] = [
  { id: 'own-1', sensitive: false },
  { id: 'own-2', sensitive: false },
  { id: 'secret', sensitive: true },
];

function proposal(kind: string, evidenceRefs: string[]) {
  return {
    kind,
    objective: 'Цель',
    evidenceRefs,
    acceptanceCriteria: ['Готово'],
    expectedSignal: 'Сигнал',
    measureAfter: '2026-12-01',
    risk: 'read_only',
  };
}

function result(extra: Partial<Record<string, unknown>>): CoachTurnResult {
  return {
    message: 'Ответ',
    phase: 'discovery',
    memoryCandidates: [],
    nextQuestion: null,
    completeness: { known: [], unknown: [] },
    safety: { needsHuman: false, reason: null },
    careerTrack: null,
    actionProposals: [],
    ...extra,
  } as unknown as CoachTurnResult;
}

describe('replyExtrasOf (B688)', () => {
  it('turns proposals into actions from the closed list, once each', () => {
    const extras = replyExtrasOf(
      result({
        actionProposals: [
          proposal('resume.revise', ['memory:own-1']),
          proposal('resume.draft', ['memory:own-1']),
          proposal('outreach.send', ['memory:own-1']),
          proposal('vacancies.search', ['memory:own-2']),
        ],
      }),
      memory,
    );
    expect(extras.actions).toEqual(['profile', 'vacancies']);
  });

  it('links only to the candidate’s own records that are not sensitive', () => {
    const extras = replyExtrasOf(
      result({
        actionProposals: [
          proposal('career.role.add', ['memory:own-2', 'memory:foreign', 'memory:secret', 'msg-1']),
        ],
        intelligence: {
          roleContributions: [{ evidenceRefs: ['memory:own-1', 'memory:own-2', 'document:x'] }],
        },
      }),
      memory,
    );
    expect(extras.memoryIds).toEqual(['own-2', 'own-1']);
    expect(extras.actions).toEqual(['career']);
  });

  it('keeps at most two actions and three links', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ id: `m${index}`, sensitive: false }));
    const extras = replyExtrasOf(
      result({
        actionProposals: [
          proposal(
            'resume.revise',
            many.map((item) => `memory:${item.id}`),
          ),
          proposal('career.conditions.update', ['memory:m0']),
          proposal('application.prepare', ['memory:m0']),
        ],
      }),
      many,
    );
    expect(extras.actions).toEqual(['profile', 'career']);
    expect(extras.memoryIds).toEqual(['m0', 'm1', 'm2']);
  });

  it('gives nothing for a plain answer', () => {
    expect(replyExtrasOf(result({}), memory)).toEqual({ actions: [], memoryIds: [] });
  });
});

describe('replyExtrasOf: nextSection (B745)', () => {
  it('без предложений действие берётся из nextSection консультанта', () => {
    const extras = replyExtrasOf(result({ nextSection: 'profile' }), memory);
    expect(extras.actions).toEqual(['profile']);
  });

  it('предложения стратега важнее nextSection', () => {
    const extras = replyExtrasOf(
      result({ nextSection: 'profile', actionProposals: [proposal('vacancies.search', ['memory:own-1'])] }),
      memory,
    );
    expect(extras.actions).toEqual(['vacancies']);
  });

  it('null, нет поля или неизвестный раздел — действий нет', () => {
    expect(replyExtrasOf(result({ nextSection: null }), memory).actions).toEqual([]);
    expect(replyExtrasOf(result({}), memory).actions).toEqual([]);
    expect(replyExtrasOf(result({ nextSection: 'settings' }), memory).actions).toEqual([]);
  });
});
