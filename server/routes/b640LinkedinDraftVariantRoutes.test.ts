import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const DRAFT_TEXT = 'Как мы сократили релиз до одного дня.';
const variantsUrl = (draftId: string) =>
  `/api/v1/candidate/b640/linkedin/drafts/${draftId}/variants`;
const listUrl = (draftId: string) =>
  `/api/v1/candidate/text-variants?kind=post&subjectId=${draftId}`;

type Writer = (input: unknown) => Promise<{ text: string }>;

function numberedWriter() {
  let calls = 0;
  return vi.fn<Writer>(async () => ({ text: `Другой пост номер ${(calls += 1)}.` }));
}

async function setup(tier: 'executive' | 'pro' | 'free' = 'executive', writer = numberedWriter()) {
  const h = await createB640Harness({
    pool: () => [],
    linkedinDraftWriter: { writeDraft: writer },
  });
  closers.push(h.close);
  const sql = (query: string, ...args: string[]) => {
    const db = new DatabaseSync(h.databasePath);
    try {
      return db.prepare(query).all(...args);
    } finally {
      db.close();
    }
  };
  sql(
    "UPDATE users SET subscription_tier = ? WHERE username IN ('flagged.test', 'other.test', 'plain.test')",
    tier,
  );
  const draftOf = (user: HarnessUser, id = `draft-${user}`) => {
    const now = new Date().toISOString();
    sql(
      `INSERT INTO candidate_drafts (id, candidate_id, kind, topic, target_post_url, text, status, local_date, created_at, updated_at)
       VALUES (?, ?, 'post', 'Релиз за день', NULL, ?, 'draft', '2026-11-23', ?, ?)`,
      id,
      h.candidateIds[user],
      DRAFT_TEXT,
      now,
      now,
    );
    return id;
  };
  const send = (url: string, payload: unknown, user: HarnessUser = 'flagged.test') =>
    h.app.inject({
      method: 'POST',
      url,
      payload: payload as object,
      headers: { authorization: `Bearer ${h.tokens[user]}`, origin: 'http://localhost:3000' },
    });
  const stored = () => sql('SELECT kind, subject_id FROM text_variants');
  return { h, send, sql, writer, draftOf, stored };
}

describe('B694 a03b: «Другой вариант» поста', () => {
  it('без флага и без входа — как несуществующий адрес; модель не зовётся', async () => {
    const { send, h, writer, draftOf } = await setup();
    const plain = draftOf('plain.test');
    expect((await send(variantsUrl(plain), {}, 'plain.test')).statusCode).toBe(404);
    expect(
      (await h.app.inject({ method: 'POST', url: variantsUrl(plain), payload: {} })).statusCode,
    ).toBe(404);
    expect(writer).not.toHaveBeenCalled();
  });

  it('пишет вариант с пожеланием, хранит его у черновика и отдаёт в списке', async () => {
    const { send, h, writer, draftOf } = await setup();
    const id = draftOf('flagged.test');
    const response = await send(variantsUrl(id), {
      wish: { chips: ['shorter'], text: 'начни с результата' },
    });
    expect(response.statusCode).toBe(201);
    const data = response.json().data;
    expect(data.remaining).toBe(2);
    expect(data.variant).toMatchObject({
      position: 1,
      text: 'Другой пост номер 1.',
      wish: { chips: ['shorter'], text: 'начни с результата' },
    });
    const input = writer.mock.calls[0]![0] as Record<string, unknown> & {
      variant: { instruction: string; previousText: string };
    };
    expect(input).toMatchObject({ kind: 'post', topic: 'Релиз за день' });
    expect(input.variant.previousText).toBe(DRAFT_TEXT);
    expect(input.variant.instruction).toContain('начни с результата');
    expect(input.variant.instruction).toContain('короче');
    const list = await h.get(listUrl(id), 'flagged.test');
    expect(list.json().data.variants.map((v: { text: string }) => v.text)).toEqual([
      'Другой пост номер 1.',
    ]);
  });

  it('чужой и несуществующий черновик — 404, модель не зовётся', async () => {
    const { send, writer, draftOf, stored } = await setup();
    const foreign = draftOf('other.test');
    expect((await send(variantsUrl(foreign), {})).statusCode).toBe(404);
    expect((await send(variantsUrl('no-such-draft'), {})).statusCode).toBe(404);
    expect(writer).not.toHaveBeenCalled();
    expect(stored()).toEqual([]);
  });

  it('три варианта, четвёртый — 409 без вызова модели', async () => {
    const { send, writer, draftOf } = await setup();
    const id = draftOf('flagged.test');
    for (let i = 0; i < 3; i += 1) expect((await send(variantsUrl(id), {})).statusCode).toBe(201);
    const fourth = await send(variantsUrl(id), {});
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().error.code).toBe('variant_limit_reached');
    expect(writer).toHaveBeenCalledTimes(3);
  });

  it('Free — 402 по правилам тарифа, модель не зовётся; Pro — посты есть (B778)', async () => {
    const free = await setup('free');
    const response = await free.send(variantsUrl(free.draftOf('flagged.test')), {});
    expect(response.statusCode).toBe(402);
    expect(response.json().error.code).toBe('paywall_required');
    expect(free.writer).not.toHaveBeenCalled();
    const pro = await setup('pro');
    expect((await pro.send(variantsUrl(pro.draftOf('flagged.test')), {})).statusCode).toBe(201);
  });

  it('сбой модели — 503 и ничего не сохранено; плохое пожелание — 400', async () => {
    const failing = vi.fn<Writer>(async () => {
      throw new Error('down');
    });
    const { send, draftOf, stored } = await setup('executive', failing);
    const id = draftOf('flagged.test');
    expect((await send(variantsUrl(id), {})).statusCode).toBe(503);
    expect(stored()).toEqual([]);
    expect((await send(variantsUrl(id), { wish: { chips: ['louder'] } })).statusCode).toBe(400);
    expect((await send(variantsUrl(id), { wish: { text: 'я'.repeat(301) } })).statusCode).toBe(400);
    expect((await send(variantsUrl(id), { extra: 1 })).statusCode).toBe(400);
  });
});
