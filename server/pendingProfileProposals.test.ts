import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CareerActionProposal } from './domain/coach';
import type { CoachProvider } from './providers/coachProvider';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './domain/resumeDraft';
import { createApp, candidateAuthorization, stores, successProvider } from './appTestHarness';

type Revision = NonNullable<CareerActionProposal['resumeRevision']>;

const NO_KEYS = {
  experienceId: null,
  memoryId: null,
  field: null,
  itemId: null,
  operation: null,
  itemField: null,
  itemFields: null,
} as const;

const REVISIONS: readonly Revision[] = [
  { ...NO_KEYS, section: 'about', proposedText: 'Руковожу платформой данных.' },
  {
    ...NO_KEYS,
    section: 'education',
    itemId: 'edu-1',
    operation: 'update',
    itemField: 'qualification',
    proposedText: 'Магистр',
  },
  {
    ...NO_KEYS,
    section: 'projects',
    itemId: 'proj-1',
    operation: 'update',
    itemField: 'description',
    proposedText: 'Новое описание',
  },
] as Revision[];

function proposalWith(resumeRevision: Revision): CareerActionProposal {
  return {
    kind: 'resume.revise',
    objective: 'Привести раздел к вакансии.',
    evidenceRefs: ['memory:fact-pending-edu'],
    acceptanceCriteria: ['Опирается на профиль.'],
    expectedSignal: 'Раздел совпадает с вакансией.',
    measureAfter: '2026-12-01',
    risk: 'candidate_data_write',
    resumeRevision,
  };
}

const DRAFT: ResumeDraft = {
  ...EMPTY_RESUME_DRAFT,
  education: [
    {
      id: 'edu-1',
      evidenceMemoryId: 'fact-pending-edu',
      institution: 'МГУ',
      qualification: 'Бакалавр',
    },
  ],
  projects: [{ id: 'proj-1', name: 'Платформа', description: 'Старое описание' }],
};

async function setup() {
  const provider: CoachProvider = {
    async createTurn(input, idempotencyKey) {
      const turn = await successProvider.createTurn(input, idempotencyKey);
      return { ...turn, result: { ...turn.result, actionProposals: REVISIONS.map(proposalWith) } };
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
      { memoryId: 'fact-pending-edu', domain: 'role-evidence', statement: 'МГУ, бакалавр' },
    ],
  });
  store.saveResumeDraft(candidateId, DRAFT, []);
  await app.inject({
    method: 'POST',
    url: '/api/v1/coach/turn',
    headers: { authorization, 'idempotency-key': randomUUID() },
    payload: { messageId: randomUUID(), content: 'Предложи правки профиля.' },
  });
  return { app, authorization };
}

async function listSections(ctx: Awaited<ReturnType<typeof setup>>): Promise<string[]> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/candidate/career-commands',
    headers: { authorization: ctx.authorization },
  });
  return (response.json().data as { executionTarget?: { section?: string } }[])
    .map((command) => command.executionTarget?.section ?? '')
    .sort();
}

describe('profile shows consultant proposals without a chat click (01.11)', () => {
  it('every resume proposal of a turn is waiting in the profile', async () => {
    const ctx = await setup();
    expect(await listSections(ctx)).toEqual(['about', 'education', 'projects']);
  });

  it('listing twice does not duplicate the proposals', async () => {
    const ctx = await setup();
    await listSections(ctx);
    expect(await listSections(ctx)).toEqual(['about', 'education', 'projects']);
  });
});
