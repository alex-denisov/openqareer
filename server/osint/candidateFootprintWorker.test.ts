import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { FootprintAdapter } from './adapters/footprintAdapter';
import { FootprintSourceError, type FootprintFinding } from './adapters/footprintAdapter';
import type { FootprintAdapterSet } from './adapters/createFootprintAdapters';
import type { ExaAdapterInput } from './adapters/exaAdapter';
import type { HibpAdapterInput } from './adapters/hibpAdapter';
import type { UsernamePresenceInput } from './adapters/usernamePresenceAdapter';
import type { WaybackAdapterInput } from './adapters/waybackAdapter';
import { SqliteCandidateReputationRepository } from '../data/sqliteCandidateReputationRepository';
import { buildCandidateFootprintQueryPlan } from './candidateFootprintQueryPlan';
import {
  cancelFootprintRunForCandidate,
  FootprintConsentRequiredError,
  startCandidateFootprintAudit,
  waitForFootprintRun,
} from './candidateFootprintWorker';

function adapter<I>(
  id: string,
  run: (input: I, signal: AbortSignal) => Promise<readonly FootprintFinding[]>,
): FootprintAdapter<I> {
  return { id, passive: true, run };
}

function noAdapter<I>(id: string): FootprintAdapter<I> {
  return { id, passive: true, run: async (_input: I, _signal: AbortSignal) => [] };
}

function adapterSet(options: {
  sherlock?: FootprintAdapter<UsernamePresenceInput>;
  maigret?: FootprintAdapter<UsernamePresenceInput>;
  hibp?: FootprintAdapter<HibpAdapterInput>;
  wayback?: FootprintAdapter<WaybackAdapterInput>;
  exa?: FootprintAdapter<ExaAdapterInput>;
} = {}): FootprintAdapterSet {
  return {
    sherlock: options.sherlock ? [options.sherlock] : [],
    maigret: options.maigret ? [options.maigret] : [],
    hibp: options.hibp ?? noAdapter<HibpAdapterInput>('hibp'),
    wayback: options.wayback ?? noAdapter<WaybackAdapterInput>('wayback'),
    exa: options.exa ?? noAdapter<ExaAdapterInput>('exa'),
  };
}

function createRepository(): SqliteCandidateReputationRepository {
  const database = new DatabaseSync(':memory:');
  return new SqliteCandidateReputationRepository({
    database,
    encryptionKey: Buffer.alloc(32, 7),
  });
}

const candidateDraft = {
  candidate: {
    fullName: 'Ada Lovelace',
    photoUrl: 'https://images.example/ada.jpg',
    contact: {
      email: 'ada@example.test',
      links: ['https://github.com/ada-lovelace'],
    },
  },
  experience: [],
  education: [],
  languages: [],
};

describe('candidateFootprintWorker', () => {
  it('runs only selected searches and stores source-specific completion states', async () => {
    const repo = createRepository();
    const plan = buildCandidateFootprintQueryPlan(candidateDraft);
    const username = plan.find((item) => item.adapterId === 'sherlock')!;
    const email = plan.find((item) => item.adapterId === 'hibp')!;
    const result: FootprintFinding = {
      adapter: 'sherlock',
      kind: 'profile',
      url: 'https://github.com/ada-lovelace',
      title: 'GitHub',
      detail: 'Открытая страница найдена по нику; владение нужно подтвердить.',
      match: 'likely_self',
      observedAt: '2026-10-04T12:00:00.000Z',
      receipt: { method: 'GET', source: 'GitHub', query: 'username=ada-lovelace' },
    };
    const sherlockRun = vi.fn(async () => [result]);
    const maigretRun = vi.fn(async () => []);
    const hibpRun = vi.fn(async () => {
      throw new FootprintSourceError('hibp', 'not_connected', 'not connected');
    });
    const audit = startCandidateFootprintAudit({
      candidateId: 'candidate-1',
      userId: 'user-1',
      plan,
      selectedQueryIds: [username.id, email.id],
      ownershipConfirmedAt: '2026-10-04T12:00:00.000Z',
      repo,
      adapters: adapterSet({
        sherlock: adapter('sherlock', sherlockRun),
        maigret: adapter('maigret', maigretRun),
        hibp: adapter('hibp', hibpRun),
      }),
      isAuthorized: () => true,
    });

    expect(audit.state).toBe('pending');
    expect(audit.adapterStatuses.find((status) => status.adapterId === 'sherlock')).toMatchObject({
      state: 'pending',
      sourcesChecked: 0,
      findingsCount: 0,
    });
    expect(audit.adapterStatuses.find((status) => status.adapterId === 'sherlock')?.checkedAt)
      .toBeUndefined();
    await waitForFootprintRun(audit.id);
    const completed = repo.getLatestFootprintAudit('candidate-1');

    expect(completed?.state).toBe('completed');
    expect(completed?.findings.map((finding) => finding.title)).toEqual(['GitHub']);
    expect(completed?.adapterStatuses.find((status) => status.adapterId === 'sherlock')?.state)
      .toBe('checked');
    expect(completed?.adapterStatuses.find((status) => status.adapterId === 'hibp')?.state)
      .toBe('not_connected');
    expect(maigretRun).not.toHaveBeenCalled();
    expect(sherlockRun).toHaveBeenCalledTimes(1);
    expect(hibpRun).toHaveBeenCalledTimes(1);
  });

  it('sends only selected employer and city context to Exa and matches selected URLs locally', async () => {
    const draft = {
      ...candidateDraft,
      candidate: {
        ...candidateDraft.candidate,
        contact: {
          ...candidateDraft.candidate.contact,
          location: 'London',
        },
      },
      experience: [
        { id: 'exp-1', chronologyMemoryId: 'mem-1', title: 'Engineer', employer: 'Selected Co', current: true, bulletMemoryIds: [] },
        { id: 'exp-2', chronologyMemoryId: 'mem-2', title: 'Analyst', employer: 'Omitted Co', current: false, bulletMemoryIds: [] },
      ],
    };
    const plan = buildCandidateFootprintQueryPlan(draft);
    const people = plan.find((item) => item.adapterId === 'exa' && item.kind === 'name')!;
    const employer = plan.find((item) => item.kind === 'work_context' && 'employers' in item.input && item.input.employers.includes('Selected Co'))!;
    const city = plan.find((item) => item.kind === 'work_context' && 'city' in item.input)!;
    const profile = plan.find((item) => item.kind === 'profile_url')!;
    const exaRun = vi.fn(async (_query: ExaAdapterInput, _signal: AbortSignal) => []);
    const repo = createRepository();
    const audit = startCandidateFootprintAudit({
      candidateId: 'candidate-1',
      userId: 'user-1',
      plan,
      selectedQueryIds: [people.id, employer.id, city.id, profile.id],
      ownershipConfirmedAt: '2026-10-04T12:00:00.000Z',
      repo,
      adapters: adapterSet({ exa: adapter('exa', exaRun) }),
      isAuthorized: () => true,
    });

    await waitForFootprintRun(audit.id);

    expect(exaRun).toHaveBeenCalledWith(expect.objectContaining({
      fullName: 'Ada Lovelace',
      photoUrl: 'https://images.example/ada.jpg',
      employers: ['Selected Co'],
      city: 'London',
      profileUrls: ['https://github.com/ada-lovelace'],
      searchPeople: true,
      searchContext: true,
    }), expect.any(AbortSignal));
    expect(JSON.stringify(exaRun.mock.calls[0]?.[0])).not.toContain('Omitted Co');
  });

  it('refuses to run any adapter without candidate consent authorization', () => {
    const repo = createRepository();
    const plan = buildCandidateFootprintQueryPlan(candidateDraft);
    const run = vi.fn(async () => []);

    expect(() => startCandidateFootprintAudit({
      candidateId: 'candidate-1',
      userId: 'user-1',
      plan,
      selectedQueryIds: [plan[0]!.id],
      ownershipConfirmedAt: '2026-10-04T12:00:00.000Z',
      repo,
      adapters: adapterSet({ sherlock: adapter('sherlock', run) }),
      isAuthorized: () => false,
    })).toThrow(FootprintConsentRequiredError);
    expect(run).not.toHaveBeenCalled();
    expect(repo.getLatestFootprintAudit('candidate-1')).toBeNull();
  });

  it('stores source failure status without retaining the provider error text', async () => {
    const repo = createRepository();
    const plan = buildCandidateFootprintQueryPlan(candidateDraft);
    const waybackItem = plan.find((item) => item.adapterId === 'wayback')!;
    const adapterRun = vi.fn(async () => {
      throw new Error('private URL https://internal.example/secret');
    });
    const pending = startCandidateFootprintAudit({
      candidateId: 'candidate-1',
      userId: 'user-1',
      plan,
      selectedQueryIds: [waybackItem.id],
      ownershipConfirmedAt: '2026-10-04T12:00:00.000Z',
      repo,
      adapters: adapterSet({ wayback: adapter('wayback', adapterRun) }),
      isAuthorized: () => true,
    });

    await waitForFootprintRun(pending.id);
    const audit = repo.getLatestFootprintAudit('candidate-1');

    expect(audit?.state).toBe('completed');
    expect(audit?.adapterStatuses.find((status) => status.adapterId === 'wayback')?.state)
      .toBe('source_error');
    expect(JSON.stringify(audit)).not.toContain('internal.example');
  });

  it('does not save findings after a candidate deletion cancels the active run', async () => {
    const repo = createRepository();
    const plan = buildCandidateFootprintQueryPlan(candidateDraft);
    const waybackItem = plan.find((item) => item.adapterId === 'wayback')!;
    const waybackRun = vi.fn((_input: WaybackAdapterInput, signal: AbortSignal) =>
      new Promise<readonly FootprintFinding[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    );
    const pending = startCandidateFootprintAudit({
      candidateId: 'candidate-1',
      userId: 'user-1',
      plan,
      selectedQueryIds: [waybackItem.id],
      ownershipConfirmedAt: '2026-10-04T12:00:00.000Z',
      repo,
      adapters: adapterSet({ wayback: adapter('wayback', waybackRun) }),
      isAuthorized: () => true,
    });

    await vi.waitFor(() => expect(waybackRun).toHaveBeenCalledTimes(1));
    cancelFootprintRunForCandidate('candidate-1');
    repo.deleteFootprintAuditsByCandidateId('candidate-1');
    await waitForFootprintRun(pending.id);

    expect(repo.getLatestFootprintAudit('candidate-1')).toBeNull();
  });
});
