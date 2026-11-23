import { afterEach, describe, expect, it } from 'vitest';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import { createB640Harness, poolItem, type HarnessUser } from '../testHelpers/b640VacancyHarness';
import { forgetMatchedListsForTests } from './matchedVacancyList';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  forgetMatchedListsForTests();
  for (const close of closers.splice(0)) await close();
});

/** B783: карточка компании открыта по ключу адреса — консультант находит ту же компанию. */
async function setup() {
  const h = await createB640Harness({
    pool: () => [poolItem({ id: 'c-1', title: 'Инженер данных', company: 'Ромашка Групп' })],
  });
  closers.push(h.close);
  const turn = (user: HarnessUser, id: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn?delivery=receipt',
      headers: {
        authorization: `Bearer ${h.tokens[user]}`,
        'idempotency-key': crypto.randomUUID(),
      },
      payload: {
        messageId: crypto.randomUUID(),
        content: 'Стоит ли сюда откликаться?',
        stage: 'vacancies',
        subject: { kind: 'company', id },
      },
    });
  return { ...h, turn };
}

describe('subject консультанта «компания» (B783)', () => {
  it('ключ адреса карточки находит компанию кандидата', async () => {
    const { turn } = await setup();
    const response = await turn('flagged.test', 'ромашкагрупп');
    expect(response.statusCode).not.toBe(404);
    expect(response.statusCode).toBeLessThan(300);
  });

  it('хеш-ключ списка по-прежнему находит компанию', async () => {
    const { turn } = await setup();
    const response = await turn('flagged.test', candidateCompanyKey('Ромашка Групп'));
    expect(response.statusCode).toBeLessThan(300);
  });

  it('компании нет у кандидата — 404 subject_not_found, не 500', async () => {
    const { turn } = await setup();
    for (const id of ['лютик', candidateCompanyKey('Лютик'), '']) {
      const response = await turn('flagged.test', id);
      expect(response.statusCode, id).toBeGreaterThanOrEqual(400);
      expect(response.statusCode, id).toBeLessThan(500);
    }
    const missing = await turn('flagged.test', 'лютик');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('subject_not_found');
  });
});
