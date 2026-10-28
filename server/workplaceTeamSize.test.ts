import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from './domain/coach';
import type { CoachProvider } from './providers/coachProvider';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { createApp, candidateAuthorization, stores, successProvider } from './appTestHarness';

/**
 * Prod 27.10: the workplace text said «8 человек», the «О себе» said «6 человек»;
 * no workplace carried a team size, so the profile read «Размер команды:
 * неизвестно» and the consultant called 6 vs 8 a contradiction.
 */
async function setup() {
  let observed: CoachTurnInput['resumeContext'];
  const provider: CoachProvider = {
    async createTurn(input, idempotencyKey) {
      observed = input.resumeContext;
      return successProvider.createTurn(input, idempotencyKey);
    },
  };
  const app = await createApp(provider);
  const authorization = candidateAuthorization(app);
  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/candidate/me',
    headers: { authorization },
  });
  const candidateId = me.json().data.candidate.id as string;
  const store = stores[stores.length - 1]!;
  store.importResumeEvidence(candidateId, {
    sourceLabel: 'Профиль кандидата',
    entries: [
      {
        memoryId: 'desc-old',
        domain: 'responsibility',
        statement: 'Распределение задач внутри отдела ( 8 человек кросфункциональная команда).',
      },
      {
        memoryId: 'desc-new',
        domain: 'responsibility',
        statement: 'Руковожу командой из 6 человек: разработка и QA.',
      },
      {
        memoryId: 'desc-none',
        domain: 'responsibility',
        statement: 'Рост конверсии на 10–15%, бюджет до 5 млн ₽.',
      },
    ],
  });
  const entry = (id: string, descriptionMemoryId: string, extra = {}) => ({
    id,
    chronologyMemoryId: `chron-${id}`,
    title: 'Руководитель разработки',
    employer: `Компания ${id}`,
    current: false,
    bulletMemoryIds: [],
    descriptionMemoryId,
    ...extra,
  });
  store.saveResumeDraft(
    candidateId,
    {
      ...EMPTY_RESUME_DRAFT,
      experience: [
        entry('new', 'desc-new', { startDate: '2024-09' }),
        entry('old', 'desc-old', { startDate: '2022-12', endDate: '2024-09' }),
        entry('none', 'desc-none'),
        entry('stated', 'desc-old', { teamSize: 30 }),
      ],
    },
    [],
  );
  return { app, authorization, readObserved: () => observed };
}

describe('team size is read and kept per workplace', () => {
  it('fills each workplace team size from its own text and keeps one the candidate stated', async () => {
    const t = await setup();
    const resume = await t.app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization: t.authorization },
    });
    const sizes = resume
      .json()
      .data.draft.experience.map((place: { id: string; teamSize?: number }) => [
        place.id,
        place.teamSize ?? null,
      ]);
    expect(sizes).toEqual([
      ['new', 6],
      ['old', 8],
      ['none', null],
      ['stated', 30],
    ]);
  });

  it('gives the consultant the team size and period of every workplace', async () => {
    const t = await setup();
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization: t.authorization, 'idempotency-key': randomUUID() },
      payload: {
        messageId: randomUUID(),
        content: 'Давай подтвердим факты в моём резюме',
        stage: 'profile',
      },
    });
    expect(t.readObserved()?.experiences).toEqual([
      expect.objectContaining({
        id: 'new',
        teamSize: 6,
        startDate: '2024-09',
        descriptionMemoryId: 'desc-new',
      }),
      expect.objectContaining({ id: 'old', teamSize: 8, startDate: '2022-12', endDate: '2024-09' }),
      expect.objectContaining({ id: 'none', teamSize: null }),
      expect.objectContaining({ id: 'stated', teamSize: 30 }),
    ]);
  });
});
