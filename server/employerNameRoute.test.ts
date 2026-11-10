import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { createApp, candidateAuthorization, stores } from './appTestHarness';

const MASK = 'Enterprise Energy IT Services';

async function appWithMaskedPlace() {
  const app = await createApp();
  const authorization = candidateAuthorization(app);
  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/candidate/me',
    headers: { authorization },
  });
  const candidateId = me.json().data.candidate.id as string;
  const store = stores[stores.length - 1]!;
  store.addManualExperienceFact(
    candidateId,
    'chronology-1',
    'VP of Technology, Enterprise Energy IT Services',
  );
  store.saveResumeDraft(
    candidateId,
    {
      ...EMPTY_RESUME_DRAFT,
      experience: [
        {
          id: 'w1',
          chronologyMemoryId: 'chronology-1',
          employer: MASK,
          current: false,
          bulletMemoryIds: [],
        },
      ],
    },
    [],
  );
  const post = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/candidate/experience/employer-name',
      headers: { authorization, origin: 'http://localhost:3000', 'idempotency-key': randomUUID() },
      payload,
    });
  return { store, candidateId, post };
}

describe('POST /api/v1/candidate/experience/employer-name (B639)', () => {
  it('сохраняет настоящее название подтверждённым фактом', async () => {
    const { store, candidateId, post } = await appWithMaskedPlace();
    const response = await post({ employer: MASK, name: 'Россети Цифра' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.memory).toMatchObject({
      status: 'confirmed',
      confidence: 'candidate-confirmed',
    });
    expect(store.getSnapshot(candidateId).resume?.draft.experience[0]).toMatchObject({
      employerRealName: 'Россети Цифра',
    });
  });

  it('принимает «это настоящее название»', async () => {
    const { store, candidateId, post } = await appWithMaskedPlace();
    expect((await post({ employer: MASK, keepAsIs: true })).statusCode).toBe(200);
    expect(store.getSnapshot(candidateId).resume?.draft.experience[0]).toMatchObject({
      employerMaskKept: true,
    });
  });

  it('пустое название и чужой работодатель отклоняются', async () => {
    const { post } = await appWithMaskedPlace();
    expect((await post({ employer: MASK, name: '  ' })).statusCode).toBe(422);
    expect((await post({ employer: 'Нет такой', name: 'X' })).statusCode).toBe(409);
  });
});
