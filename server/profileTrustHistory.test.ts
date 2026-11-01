import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CareerActionProposal } from './domain/coach';
import type { CoachProvider } from './providers/coachProvider';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { createApp, candidateAuthorization, stores, successProvider } from './appTestHarness';

const ORIGIN = 'http://localhost:3000';
const EXPERIENCE_ID = 'exp-trust-1';
const EDITED = 'fact-trust-edited';
const OTHER = 'fact-trust-other';
const CHRONOLOGY = 'fact-trust-chronology';

function providerWith(proposal: CareerActionProposal): CoachProvider {
  return {
    async createTurn(input, idempotencyKey) {
      const turn = await successProvider.createTurn(input, idempotencyKey);
      return { ...turn, result: { ...turn.result, actionProposals: [proposal] } };
    },
  };
}

const proposal: CareerActionProposal = {
  kind: 'resume.revise',
  objective: 'Уточнить результат.',
  evidenceRefs: [`memory:${EDITED}`],
  acceptanceCriteria: ['Опирается на факт.'],
  expectedSignal: 'Результат виден.',
  measureAfter: '2026-12-01',
  risk: 'candidate_data_write',
  resumeRevision: {
    section: 'experience',
    experienceId: EXPERIENCE_ID,
    memoryId: EDITED,
    proposedText: 'Сократил время релиза с недели до дня.',
  },
};

async function setup() {
  const app = await createApp(providerWith(proposal));
  const authorization = candidateAuthorization(app);
  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/candidate/me',
    headers: { authorization },
  });
  const candidateId = me.json().data.candidate.id as string;
  const store = stores[stores.length - 1]!;
  store.importResumeEvidence(candidateId, {
    sourceLabel: 'Факт из профиля кандидата',
    entries: [
      { memoryId: EDITED, domain: 'outcome', statement: 'Ускорил релизы.' },
      { memoryId: OTHER, domain: 'responsibility', statement: 'Вёл команду из 5 человек.' },
      { memoryId: CHRONOLOGY, domain: 'role-evidence', statement: 'Lead · Acme · 2020–2024' },
    ],
  });
  store.changeMemory(candidateId, EDITED, { action: 'confirm' });
  store.saveResumeDraft(
    candidateId,
    {
      ...EMPTY_RESUME_DRAFT,
      experience: [
        {
          id: EXPERIENCE_ID,
          chronologyMemoryId: CHRONOLOGY,
          title: 'Lead',
          employer: 'Acme',
          current: false,
          bulletMemoryIds: [EDITED, OTHER],
        },
      ],
    },
    [],
  );
  return { app, authorization, candidateId, store };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function trust({ store, candidateId }: Setup, id: string) {
  const fact = store.getSnapshot(candidateId).memory.find((item) => item.id === id);
  return { status: fact?.status, confidence: fact?.confidence };
}

async function acceptProposal(ctx: Setup): Promise<string> {
  const turnIdempotencyKey = randomUUID();
  await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/coach/turn',
    headers: { authorization: ctx.authorization, 'idempotency-key': turnIdempotencyKey },
    payload: { messageId: randomUUID(), content: 'Предложи правку опыта.' },
  });
  const commandId = randomUUID();
  const headers = {
    authorization: ctx.authorization,
    origin: ORIGIN,
    'idempotency-key': commandId,
  };
  const prepared = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/candidate/career-commands',
    headers,
    payload: { turnIdempotencyKey, proposalIndex: 0 },
  });
  expect(prepared.statusCode).toBe(201);
  const approved = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
    headers,
  });
  expect(approved.statusCode).toBe(200);
  return commandId;
}

async function history(ctx: Setup, page = 0) {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/candidate/profile/history?page=${page}`,
    headers: { authorization: ctx.authorization },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as {
    entries: {
      id: string;
      actor: string;
      section: string;
      kind: string;
      label: string;
      previousText: string;
      appliedText: string;
      revertedAt: string | null;
    }[];
    total: number;
    pageSize: number;
  };
}

function revertChange(ctx: Setup, changeId: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/candidate/profile/history/${changeId}/revert`,
    headers: { authorization: ctx.authorization, origin: ORIGIN },
  });
}

async function putDraft(ctx: Setup, headline: string) {
  const current = ctx.store.getSnapshot(ctx.candidateId).resume!.draft;
  const response = await ctx.app.inject({
    method: 'PUT',
    url: '/api/v1/candidate/resume',
    headers: { authorization: ctx.authorization, origin: ORIGIN },
    payload: { ...current, candidate: { ...current.candidate, headline } },
  });
  expect(response.statusCode).toBe(200);
}

describe('«Принять» подтверждает данные карьеры (01.11)', () => {
  it('accept marks the touched fact and every fact of the workplace candidate-confirmed', async () => {
    const ctx = await setup();
    const before = trust(ctx, OTHER);
    expect(before).not.toEqual({ status: 'confirmed', confidence: 'candidate-confirmed' });

    await acceptProposal(ctx);

    for (const id of [EDITED, OTHER, CHRONOLOGY]) {
      expect(trust(ctx, id)).toEqual({ status: 'confirmed', confidence: 'candidate-confirmed' });
    }
    const edited = ctx.store.getSnapshot(ctx.candidateId).memory.find((m) => m.id === EDITED);
    expect(edited?.consultantConfirmedAt).toEqual(expect.any(String));
  });

  it('revert restores the previous status and confidence of every fact the accept changed', async () => {
    const ctx = await setup();
    const before = Object.fromEntries(
      [EDITED, OTHER, CHRONOLOGY].map((id) => [id, trust(ctx, id)]),
    );
    const commandId = await acceptProposal(ctx);

    const reverted = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/revert`,
      headers: { authorization: ctx.authorization, origin: ORIGIN },
    });

    expect(reverted.statusCode).toBe(200);
    for (const id of [EDITED, OTHER, CHRONOLOGY]) expect(trust(ctx, id)).toEqual(before[id]);
    const [entry] = (await history(ctx)).entries;
    expect(entry).toMatchObject({ actor: 'consultant', revertedAt: expect.any(String) });
  });

  it('explicit «Подтвердить» confirms a workplace without a consultant proposal and can be returned', async () => {
    const ctx = await setup();
    const before = trust(ctx, OTHER);
    const confirmed = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/candidate/profile/experience/${EXPERIENCE_ID}/confirm`,
      headers: { authorization: ctx.authorization, origin: ORIGIN },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(trust(ctx, OTHER)).toEqual({ status: 'confirmed', confidence: 'candidate-confirmed' });

    const [entry] = (await history(ctx)).entries;
    expect(entry).toMatchObject({ actor: 'candidate', kind: 'confirmation', label: 'Lead · Acme' });
    expect((await revertChange(ctx, entry.id)).statusCode).toBe(200);
    expect(trust(ctx, OTHER)).toEqual(before);
  });
});

describe('«История изменений» профиля', () => {
  it('logs a manual edit with the old and new value', async () => {
    const ctx = await setup();
    await putDraft(ctx, 'Engineering Lead');

    const page = await history(ctx);
    expect(page.pageSize).toBe(20);
    expect(page.entries[0]).toMatchObject({
      actor: 'candidate',
      section: 'headline',
      previousText: '',
      appliedText: 'Engineering Lead',
      revertedAt: null,
    });
  });

  it('«Вернуть» restores the previous value and refuses when the value changed since', async () => {
    const ctx = await setup();
    await putDraft(ctx, 'Engineering Lead');
    await putDraft(ctx, 'Head of Engineering');
    const [latest, earlier] = (await history(ctx)).entries;

    const conflict = await revertChange(ctx, earlier.id);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('profile_change_conflict');

    expect((await revertChange(ctx, latest.id)).statusCode).toBe(200);
    expect(ctx.store.getSnapshot(ctx.candidateId).resume?.draft.candidate.headline).toBe(
      'Engineering Lead',
    );
    expect((await revertChange(ctx, latest.id)).statusCode).toBe(409);
  });

  it('pages the log by 20', async () => {
    const ctx = await setup();
    for (let index = 0; index < 21; index += 1) await putDraft(ctx, `Lead ${index}`);
    const first = await history(ctx, 0);
    const second = await history(ctx, 1);
    expect(first.total).toBe(21);
    expect(first.entries).toHaveLength(20);
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0].appliedText).toBe('Lead 0');
  });
});

describe('История показывает правки консультанта до релиза журнала', () => {
  function forgetLog(ctx: Setup): void {
    const { database } = ctx.store as unknown as {
      database: { prepare(sql: string): { run(...args: unknown[]): unknown } };
    };
    database.prepare('DELETE FROM profile_change_log WHERE candidate_id = ?').run(ctx.candidateId);
  }

  it('lists an accepted profile_revisions edit that has no log entry, and «Вернуть» reverts it', async () => {
    const ctx = await setup();
    await acceptProposal(ctx);
    forgetLog(ctx);

    const page = await history(ctx);
    expect(page.total).toBe(1);
    const [entry] = page.entries;
    expect(entry).toMatchObject({
      actor: 'consultant',
      section: 'experience',
      previousText: 'Ускорил релизы.',
      appliedText: 'Сократил время релиза с недели до дня.',
      revertedAt: null,
    });

    const reverted = await revertChange(ctx, entry.id);
    expect(reverted.statusCode).toBe(200);
    expect((await history(ctx)).entries[0].revertedAt).toEqual(expect.any(String));
  });

  it('does not list a revision twice when the log already has it', async () => {
    const ctx = await setup();
    await acceptProposal(ctx);
    expect((await history(ctx)).total).toBe(1);
  });
});

describe('История пишет навыки по-русски, без JSON (01.11)', () => {
  it('shows a legacy skill revision as «Навык ITIL — подтверждён проверкой», было «»', async () => {
    const ctx = await setup();
    ctx.store.profileRevisionRepo.recordRevision({
      id: randomUUID(),
      candidateId: ctx.candidateId,
      commandId: randomUUID(),
      section: 'skills',
      experienceId: 'itil',
      previousText: 'null',
      appliedText: JSON.stringify({
        name: 'ITIL',
        status: 'подтверждён',
        source: 'квиз openqareer',
        verifiedAt: '2026-10-28T13:06:00.000Z',
      }),
      createdAt: '2026-10-28T13:06:00.000Z',
    });

    const [entry] = (await history(ctx)).entries;
    expect(entry).toMatchObject({
      section: 'skills',
      label: 'ITIL',
      previousText: '',
      appliedText: 'Навык ITIL — подтверждён проверкой',
    });
  });
});
