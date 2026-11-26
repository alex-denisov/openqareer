import { describe, expect, it } from 'vitest';
import { seedResume, setup } from './testHelpers/letterApprovalHarness';

const OLD = 'CSAT вырос с 23% до 68%';
const LETTER = 'Добрый день. Повысил CSAT с 23% до 68%. Резюме приложено.';
const BULLET = 'import:test:bullet-0';
const DRAFT_URL = '/api/v1/candidate/vacancies/cluster-99/letter-draft';

async function approvedWithOldFact() {
  const stand = await setup();
  seedResume(stand.candidates, stand.candidateId, 'Head of Platform', [OLD]);
  const correct = () =>
    stand.candidates.changeMemory(stand.candidateId, BULLET, {
      action: 'correct',
      statement: 'CSAT вырос с 25% до 85%',
    });
  return { ...stand, correct };
}

describe('письмо после исправления факта профиля', () => {
  it('одобренное письмо с прежним числом отмечено устаревшим, без правки факта — нет', async () => {
    const { approve, readApproval, correct } = await approvedWithOldFact();
    await approve({ body: LETTER });
    expect((await readApproval()).json().data.approval).toMatchObject({
      factsChanged: false,
      profileChanged: false,
    });
    correct();
    expect((await readApproval()).json().data.approval).toMatchObject({
      body: LETTER,
      factsChanged: true,
      profileChanged: true,
    });
  });

  it('черновик по прежнему профилю со старым числом не одобряется', async () => {
    const { pitch, approve, correct } = await approvedWithOldFact();
    const { profileHash } = (await pitch()).json().data;
    expect(profileHash).toMatch(/^[0-9a-f]{64}$/u);
    correct();
    const refused = await approve({ body: LETTER, profileHash });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('letter_facts_changed');
    expect((await approve({ body: 'Добрый день.', profileHash })).statusCode).toBe(200);
  });

  it('новое одобрение со своим числом снимает отметку', async () => {
    const { approve, readApproval, correct } = await approvedWithOldFact();
    correct();
    await approve({ body: 'Выйду через 14 дней.' });
    expect((await readApproval()).json().data.approval.factsChanged).toBe(false);
  });
});

describe('правка письма до одобрения', () => {
  it('переживает перезагрузку, одобренный текст остаётся; одобрение её убирает', async () => {
    const { call, approve, readApproval } = await approvedWithOldFact();
    await approve({ body: LETTER });
    expect((await readApproval()).json().data.draft).toBeNull();
    expect((await call('PUT', DRAFT_URL, { body: 'Первая правка.' })).statusCode).toBe(200);
    expect(
      (await call('PUT', DRAFT_URL, { body: 'Моя правка.', variantId: 'v-1' })).statusCode,
    ).toBe(200);
    expect((await readApproval()).json().data).toMatchObject({
      approval: { body: LETTER },
      draft: { body: 'Моя правка.', variantId: 'v-1', factsChanged: false },
    });
    await approve({ body: 'Моя правка.' });
    expect((await readApproval()).json().data).toMatchObject({
      approval: { body: 'Моя правка.' },
      draft: null,
    });
  });

  it('факт правки исправили — черновик отмечен устаревшим', async () => {
    const { call, readApproval, correct } = await approvedWithOldFact();
    await call('PUT', DRAFT_URL, { body: LETTER });
    correct();
    expect((await readApproval()).json().data.draft.factsChanged).toBe(true);
  });

  it('пустая правка и незнакомая вакансия не сохраняются; чужому правка не видна', async () => {
    const { call } = await approvedWithOldFact();
    expect((await call('PUT', DRAFT_URL, { body: ' ' })).statusCode).toBe(400);
    expect((await call('PUT', DRAFT_URL.replace('99', '404'), { body: 'x' })).statusCode).toBe(404);
    const other = await setup();
    expect((await other.readApproval()).json().data.draft).toBeNull();
  });
});
