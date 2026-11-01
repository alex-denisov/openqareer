import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { careerActionProposalSchema, type CareerActionProposal } from './domain/coach';
import type { CoachProvider } from './providers/coachProvider';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './domain/resumeDraft';
import { resumeContextOf } from './data/resumeTurnContext';
import { createApp, candidateAuthorization, stores, successProvider } from './appTestHarness';

const ORIGIN = 'http://localhost:3000';
const EDU_FACT = 'fact-item-edu';
const LANG_FACT = 'fact-item-lang';

type Revision = NonNullable<CareerActionProposal['resumeRevision']>;

const NO_ITEM = { experienceId: null, memoryId: null, field: null } as const;

function proposalWith(resumeRevision: Revision): CareerActionProposal {
  return {
    kind: 'resume.revise',
    objective: 'Привести раздел к вакансии.',
    evidenceRefs: [`memory:${EDU_FACT}`],
    acceptanceCriteria: ['Опирается на профиль.'],
    expectedSignal: 'Раздел совпадает с вакансией.',
    measureAfter: '2026-12-01',
    risk: 'candidate_data_write',
    resumeRevision,
  };
}

function update(section: string, itemId: string, itemField: string, text: string): Revision {
  return {
    ...NO_ITEM,
    section,
    itemId,
    operation: 'update',
    itemField,
    itemFields: null,
    proposedText: text,
  } as Revision;
}

const DRAFT: ResumeDraft = {
  ...EMPTY_RESUME_DRAFT,
  education: [
    { id: 'edu-1', evidenceMemoryId: EDU_FACT, institution: 'МГУ', qualification: 'Бакалавр' },
  ],
  projects: [{ id: 'proj-1', name: 'Платформа', description: 'Старое описание' }],
  certifications: [{ id: 'cert-1', name: 'AWS SA', url: 'https://example.com/private' }],
  languages: [{ id: 'lang-1', evidenceMemoryId: LANG_FACT, name: 'Английский', cefr: 'B2' }],
  courses: [{ id: 'course-1', name: 'ML' }],
  achievements: [{ id: 'ach-1', kind: 'honor', title: 'Лучший сотрудник' }],
};

async function setup(revision: Revision) {
  const provider: CoachProvider = {
    async createTurn(input, idempotencyKey) {
      const turn = await successProvider.createTurn(input, idempotencyKey);
      return { ...turn, result: { ...turn.result, actionProposals: [proposalWith(revision)] } };
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
    sourceLabel: 'Факт из профиля кандидата',
    entries: [
      { memoryId: EDU_FACT, domain: 'role-evidence', statement: 'МГУ, бакалавр' },
      { memoryId: LANG_FACT, domain: 'role-evidence', statement: 'Английский B2' },
    ],
  });
  store.saveResumeDraft(candidateId, DRAFT, []);
  return { app, authorization, candidateId, store };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function headersFor(ctx: Setup, key: string) {
  return { authorization: ctx.authorization, origin: ORIGIN, 'idempotency-key': key };
}

async function prepare(ctx: Setup): Promise<string> {
  const turnIdempotencyKey = randomUUID();
  await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/coach/turn',
    headers: { authorization: ctx.authorization, 'idempotency-key': turnIdempotencyKey },
    payload: { messageId: randomUUID(), content: 'Предложи правку профиля.' },
  });
  const commandId = randomUUID();
  const prepared = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/candidate/career-commands',
    headers: headersFor(ctx, commandId),
    payload: { turnIdempotencyKey, proposalIndex: 0 },
  });
  expect(prepared.statusCode).toBe(201);
  return commandId;
}

function approve(ctx: Setup, commandId: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
    headers: headersFor(ctx, commandId),
  });
}

function revert(ctx: Setup, commandId: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/candidate/career-commands/${commandId}/revert`,
    headers: { authorization: ctx.authorization, origin: ORIGIN },
  });
}

function draftOf(ctx: Setup): ResumeDraft {
  return ctx.store.getSnapshot(ctx.candidateId).resume!.draft;
}

function section(ctx: Setup, name: string): Record<string, unknown>[] {
  return ((draftOf(ctx) as unknown as Record<string, unknown>)[name] ?? []) as Record<
    string,
    unknown
  >[];
}

async function history(ctx: Setup) {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/candidate/profile/history?page=0',
    headers: { authorization: ctx.authorization },
  });
  return response.json().data.entries as {
    actor: string;
    section: string;
    label: string;
    revertedAt: string | null;
  }[];
}

describe('consultant proposals for every profile section — schema (01.11)', () => {
  const valid: Revision[] = [
    update('education', 'edu-1', 'qualification', 'Магистр'),
    update('projects', 'proj-1', 'description', 'Новая платформа'),
    update('certifications', 'cert-1', 'issuer', 'Amazon'),
    update('languages', 'lang-1', 'cefr', 'C1'),
    update('courses', 'course-1', 'provider', 'Coursera'),
    update('achievements', 'ach-1', 'title', 'Лучший руководитель'),
    {
      ...NO_ITEM,
      section: 'languages',
      itemId: null,
      operation: 'add',
      itemField: null,
      itemFields: [
        { field: 'name', text: 'Немецкий' },
        { field: 'cefr', text: 'A2' },
      ],
      proposedText: 'Немецкий · A2',
    } as Revision,
    {
      ...NO_ITEM,
      section: 'projects',
      itemId: 'proj-1',
      operation: 'remove',
      itemField: null,
      itemFields: null,
      proposedText: 'Платформа',
    } as Revision,
  ];

  it.each(valid.map((revision) => [`${revision.section} ${revision.operation}`, revision]))(
    'accepts %s',
    (_name, revision) => {
      expect(careerActionProposalSchema.safeParse(proposalWith(revision)).success).toBe(true);
    },
  );

  it.each([
    ['update without a field', update('education', 'edu-1', '', 'x')],
    ['a field another section owns', update('languages', 'lang-1', 'institution', 'МГУ')],
    ['an unknown language level', update('languages', 'lang-1', 'cefr', 'native')],
    ['an item target on headline', { ...update('headline', 'x', 'name', 'x') }],
    [
      'an add without required fields',
      {
        ...NO_ITEM,
        section: 'education',
        itemId: null,
        operation: 'add',
        itemField: null,
        itemFields: [{ field: 'qualification', text: 'Магистр' }],
        proposedText: 'Магистр',
      } as Revision,
    ],
  ])('refuses %s', (_name, revision) => {
    expect(careerActionProposalSchema.safeParse(proposalWith(revision as Revision)).success).toBe(
      false,
    );
  });

  it('keeps old stored proposals without item keys valid', () => {
    const stored = proposalWith({
      section: 'about',
      experienceId: null,
      memoryId: null,
      proposedText: 'Обо мне',
    });
    expect(careerActionProposalSchema.safeParse(stored).success).toBe(true);
  });

  it('gives the consultant every list item by id without links or evidence ids', () => {
    const items = resumeContextOf(DRAFT).profileItems ?? [];
    expect(items.map((item) => `${item.section}:${item.id}`)).toEqual([
      'education:edu-1',
      'projects:proj-1',
      'certifications:cert-1',
      'languages:lang-1',
      'courses:course-1',
      'achievements:ach-1',
    ]);
    expect(JSON.stringify(items)).not.toContain('example.com');
    expect(JSON.stringify(items)).not.toContain(EDU_FACT);
  });
});

describe('consultant item revisions — apply, history, revert (01.11)', () => {
  it.each([
    ['education', 'edu-1', 'qualification', 'Магистр', 'Бакалавр'],
    ['projects', 'proj-1', 'description', 'Платформа для 2 млн клиентов', 'Старое описание'],
    ['certifications', 'cert-1', 'issuer', 'Amazon', undefined],
    ['languages', 'lang-1', 'cefr', 'C1', 'B2'],
    ['courses', 'course-1', 'provider', 'Coursera', undefined],
    ['achievements', 'ach-1', 'title', 'Лучший руководитель', 'Лучший сотрудник'],
  ])(
    '%s: «Принять» writes the field and logs it, revert restores it',
    async (name, id, field, text, before) => {
      const ctx = await setup(update(name, id, field, text));
      const commandId = await prepare(ctx);

      expect((await approve(ctx, commandId)).statusCode).toBe(200);
      expect(section(ctx, name).find((item) => item.id === id)?.[field]).toBe(text);
      const [entry] = await history(ctx);
      expect(entry).toMatchObject({ actor: 'consultant', section: name, revertedAt: null });

      const reverted = await revert(ctx, commandId);
      expect(reverted.statusCode).toBe(200);
      expect(reverted.json().data.profileRevisionReverted).toBe(true);
      expect(section(ctx, name).find((item) => item.id === id)?.[field]).toBe(before);
      expect((await history(ctx))[0]?.revertedAt).toEqual(expect.any(String));
    },
  );

  it('an added language gets the candidate fact, is confirmed and goes away on revert', async () => {
    const ctx = await setup({
      ...NO_ITEM,
      section: 'languages',
      itemId: null,
      operation: 'add',
      itemField: null,
      itemFields: [
        { field: 'name', text: 'Немецкий' },
        { field: 'cefr', text: 'A2' },
      ],
      proposedText: 'Немецкий · A2',
    } as Revision);
    const commandId = await prepare(ctx);
    expect((await approve(ctx, commandId)).statusCode).toBe(200);

    const added = section(ctx, 'languages').find((item) => item.name === 'Немецкий');
    expect(added).toMatchObject({ cefr: 'A2' });
    const fact = ctx.store
      .getSnapshot(ctx.candidateId)
      .memory.find((memory) => memory.id === added?.evidenceMemoryId);
    expect(fact?.status).toBe('confirmed');

    expect((await revert(ctx, commandId)).statusCode).toBe(200);
    expect(section(ctx, 'languages').map((item) => item.id)).toEqual(['lang-1']);
  });

  it('a removal is applied only on «Принять» and revert puts the item back', async () => {
    const ctx = await setup({
      ...NO_ITEM,
      section: 'projects',
      itemId: 'proj-1',
      operation: 'remove',
      itemField: null,
      itemFields: null,
      proposedText: 'Платформа',
    } as Revision);
    const commandId = await prepare(ctx);
    expect(section(ctx, 'projects')).toHaveLength(1);

    expect((await approve(ctx, commandId)).statusCode).toBe(200);
    expect(section(ctx, 'projects')).toHaveLength(0);

    expect((await revert(ctx, commandId)).statusCode).toBe(200);
    expect(section(ctx, 'projects')[0]).toMatchObject({ id: 'proj-1', name: 'Платформа' });
  });

  it('«Принять» confirms the edited item fact as candidate-confirmed', async () => {
    const ctx = await setup(update('education', 'edu-1', 'qualification', 'Магистр'));
    await approve(ctx, await prepare(ctx));
    const fact = ctx.store
      .getSnapshot(ctx.candidateId)
      .memory.find((memory) => memory.id === EDU_FACT);
    expect(fact).toMatchObject({ status: 'confirmed', confidence: 'candidate-confirmed' });
  });

  it('refuses a stale target: the candidate changed the field after the proposal', async () => {
    const ctx = await setup(update('projects', 'proj-1', 'description', 'Новая'));
    const commandId = await prepare(ctx);
    ctx.store.saveResumeDraft(
      ctx.candidateId,
      { ...draftOf(ctx), projects: [{ id: 'proj-1', name: 'Платформа', description: 'Моё' }] },
      [],
    );

    const approved = await approve(ctx, commandId);

    expect(approved.statusCode).toBe(409);
    expect(section(ctx, 'projects')[0]?.description).toBe('Моё');
  });

  it('refuses revert when the item changed after the accept', async () => {
    const ctx = await setup(update('courses', 'course-1', 'provider', 'Coursera'));
    const commandId = await prepare(ctx);
    await approve(ctx, commandId);
    ctx.store.saveResumeDraft(
      ctx.candidateId,
      { ...draftOf(ctx), courses: [{ id: 'course-1', name: 'ML', provider: 'Stepik' }] },
      [],
    );

    expect((await revert(ctx, commandId)).statusCode).toBe(409);
    expect(section(ctx, 'courses')[0]?.provider).toBe('Stepik');
  });
});
