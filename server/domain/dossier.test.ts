import { describe, expect, it } from 'vitest';
import { buildExperienceDossier } from './dossier';

const baseMemory = {
  kind: 'fact' as const,
  confidence: 'candidate-reported' as const,
  sensitive: false,
  status: 'confirmed' as const,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

describe('experience dossier projection', () => {
  it('requires confirmed responsibility, outcome, capability and direction', () => {
    const dossier = buildExperienceDossier([
      {
        ...baseMemory,
        id: 'responsibility',
        domain: 'responsibility',
        statement: 'Отвечал за запуск B2B-продукта.',
        sourceMessageIds: ['message-1'],
      },
      {
        ...baseMemory,
        id: 'outcome',
        domain: 'outcome',
        statement: 'Запустил продукт для первых десяти клиентов.',
        sourceMessageIds: ['message-2'],
      },
      {
        ...baseMemory,
        id: 'skill',
        domain: 'skill',
        statement: 'Проводил discovery-интервью.',
        sourceMessageIds: ['message-3'],
      },
      {
        ...baseMemory,
        id: 'preference',
        kind: 'preference',
        domain: 'preference',
        statement: 'Предпочитает B2B SaaS.',
        sourceMessageIds: ['message-4'],
      },
    ]);

    expect(dossier.readiness.complete).toBe(true);
    expect(dossier.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'impact', complete: true }),
        expect.objectContaining({ id: 'direction', complete: true }),
      ]),
    );
    expect(
      dossier.sections.find((section) => section.domain === 'outcome')?.items[0],
    ).toMatchObject({
      memoryId: 'outcome',
      sourceMessageIds: ['message-2'],
    });
  });

  it('keeps proposed evidence visible and blocks unresolved open questions', () => {
    const dossier = buildExperienceDossier([
      {
        ...baseMemory,
        id: 'proposed-outcome',
        domain: 'outcome',
        statement: 'Возможно, улучшил конверсию.',
        sourceMessageIds: ['message-1'],
        status: 'proposed',
      },
      {
        ...baseMemory,
        id: 'question',
        domain: 'gap',
        kind: 'open-question',
        statement: 'Неясна причина перерыва.',
        sourceMessageIds: ['message-2'],
        status: 'proposed',
      },
    ]);

    expect(dossier.readiness.complete).toBe(false);
    expect(dossier.readiness.unresolvedQuestions).toBe(1);
    expect(dossier.confirmedCount).toBe(0);
    expect(dossier.proposedCount).toBe(2);
  });
});
