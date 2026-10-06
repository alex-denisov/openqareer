import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SqlitePoolInvitationRepository,
  hashInvitationTarget,
} from '../data/sqlitePoolInvitationRepository';
import { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';
import { pauseLinkedinPoolAccountForManualReview } from './executorAuditRepository';
import { INVITATION_LIMITS, planInvitations } from './invitationBudgetPolicy';
import {
  readPoolInvitationHashKey,
  readPoolInvitationTiming,
  runPoolInvitationStep,
  type InvitationStepDependencies,
  type InvitationSendOutcome,
} from './poolInvitationStep';

const KEY = Buffer.alloc(32, 73);
const ACTOR = { actorUserId: 'test-admin', actorUsername: 'test.admin' };
const NOW = new Date('2026-10-06T12:00:00.000Z');
const RESOURCES: Array<{ repository: SqliteLinkedinPoolRepository; directory: string }> = [];

afterEach(() => {
  for (const resource of RESOURCES.splice(0)) {
    resource.repository.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

async function createReadyAccount(createdAt = '2025-08-01T12:00:00.000Z') {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-b416-'));
  const repository = new SqliteLinkedinPoolRepository({
    databasePath: ':memory:',
    encryptionKey: KEY,
    runtimeRoot: join(directory, 'runtime'),
    now: () => new Date(createdAt),
  });
  const created = repository.create({
    adminLabel: 'Тестовый искусственный аккаунт',
    emailLogin: 'synthetic-pool@example.test',
    providerAccountMarker: 'synthetic-b416',
    idempotencyKey: 'a416d000-0000-4000-8000-000000000001',
    ...ACTOR,
  }).account;
  const login = await repository.beginLogin(created.id, ACTOR);
  const ready = await repository.completeLogin(created.id, login.lease.handle, {
    state: 'ready',
    accountMarker: 'synthetic-b416',
  });
  RESOURCES.push({ repository, directory });
  return { repository, account: ready };
}

function syntheticCandidates(company = 'Example Labs', count = 12) {
  return Array.from({ length: count }, (_, index) => ({
    profileUrl: 'https://www.linkedin.com/in/synthetic-person-' + index,
    company,
    kind: 'recruiter' as const,
  }));
}

async function setup(overrides: Record<string, unknown> = {}, createdAt?: string) {
  const { repository: poolRepository, account } = await createReadyAccount(createdAt);
  const repository = new SqlitePoolInvitationRepository(poolRepository.getDatabase());
  const send = vi.fn(async (_url: string): Promise<InvitationSendOutcome> => 'sent');
  const now = { value: new Date(NOW) };
  const dependencies = {
    enabled: true,
    accountId: account.id,
    timezone: 'UTC',
    repository,
    poolRepository,
    hashKey: KEY,
    isHalted: () => false,
    isBackingOff: () => false,
    accountAgeDays: () => 400,
    candidates: () => syntheticCandidates(),
    send,
    onPlatformSignal: vi.fn(),
    now: () => new Date(now.value),
    random: () => 0,
    wait: vi.fn(async (_milliseconds: number) => undefined),
    timing: { minDelayMs: 60_000, maxDelayMs: 180_000, failurePauseMs: 60_000 },
    ...overrides,
  } as unknown as InvitationStepDependencies;
  return { dependencies, repository, poolRepository, account, send, now };
}

describe('B416 invitation hardening', () => {
  it('requires an external hash key and validates configurable timing defaults', () => {
    expect(readPoolInvitationHashKey({})).toBeNull();
    expect(readPoolInvitationHashKey({ OPENQAREER_POOL_HASH_KEY: 'x'.repeat(32) })).toEqual(
      Buffer.alloc(32, 'x'),
    );
    expect(readPoolInvitationTiming({})).toEqual({
      delayMinMs: 60_000,
      delayMaxMs: 180_000,
      failurePauseMs: 60 * 60_000,
    });
    expect(
      readPoolInvitationTiming({
        OPENQAREER_POOL_INVITATION_DELAY_MIN_SECONDS: '90',
        OPENQAREER_POOL_INVITATION_DELAY_MAX_SECONDS: '210',
        OPENQAREER_POOL_INVITATION_FAILURE_PAUSE_MINUTES: '30',
      }),
    ).toEqual({ delayMinMs: 90_000, delayMaxMs: 210_000, failurePauseMs: 30 * 60_000 });
    expect(() =>
      readPoolInvitationTiming({
        OPENQAREER_POOL_INVITATION_DELAY_MIN_SECONDS: '180',
        OPENQAREER_POOL_INVITATION_DELAY_MAX_SECONDS: '60',
      }),
    ).toThrow(/delay_range_invalid/u);
  });

  it('returns busy for a second in-flight run on the same account', async () => {
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    let firstSend = true;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const send = vi.fn(async () => {
      if (firstSend) {
        firstSend = false;
        started();
        await gate;
      }
      return 'sent' as const;
    });
    const run = await setup({ send, candidates: () => syntheticCandidates('OneCo', 1) });
    const first = runPoolInvitationStep(run.dependencies);

    await waiting;
    const second = await runPoolInvitationStep(run.dependencies);
    expect(second).toMatchObject({ status: 'busy', sent: 0 });
    release();
    await first;
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      run.repository.counters(run.account.id, NOW, new Date('2026-10-06T00:00:00.000Z'))
        .attemptedToday,
    ).toBe(1);
  });

  it('counts a failed send as an attempt and pauses the account for the configured time', async () => {
    const run = await setup({
      send: vi.fn(async () => 'failed' as const),
      timing: { minDelayMs: 60_000, maxDelayMs: 180_000, failurePauseMs: 90_000 },
      candidates: () => syntheticCandidates('OneCo', 1),
    });

    const report = await runPoolInvitationStep(run.dependencies);
    const counters = run.repository.counters(
      run.account.id,
      NOW,
      new Date('2026-10-06T00:00:00.000Z'),
    );

    expect(report.reason).toBe('send_failed');
    expect(counters.attemptedToday).toBe(1);
    expect(run.poolRepository.findAccount(run.account.id)).toMatchObject({
      state: 'cooling_down',
      leaseUntil: new Date(NOW.getTime() + 90_000).toISOString(),
    });
  });

  it('counts an exception as a failed attempt and applies the same cooldown', async () => {
    const run = await setup({
      send: vi.fn(async () => {
        throw new Error('synthetic transport failure');
      }),
      candidates: () => syntheticCandidates('OneCo', 1),
    });

    const report = await runPoolInvitationStep(run.dependencies);
    expect(report.reason).toBe('send_failed');
    expect(
      run.repository.counters(run.account.id, NOW, new Date('2026-10-06T00:00:00.000Z'))
        .attemptedToday,
    ).toBe(1);
    expect(run.poolRepository.findAccount(run.account.id)?.state).toBe('cooling_down');
  });

  it('uses the existing manual-review pause when LinkedIn returns a challenge', async () => {
    const run = await setup({
      send: vi.fn(async () => 'challenge' as const),
      candidates: () => syntheticCandidates('OneCo', 1),
    });

    const report = await runPoolInvitationStep(run.dependencies);
    expect(report).toMatchObject({ status: 'halted', reason: 'challenge' });
    expect(
      run.repository.counters(run.account.id, NOW, new Date('2026-10-06T00:00:00.000Z'))
        .attemptedToday,
    ).toBe(1);
    expect(run.poolRepository.findAccount(run.account.id)?.state).toBe('user_action_required');
  });

  it('does no work while the pool account is paused for manual review', async () => {
    const run = await setup({ candidates: vi.fn(() => syntheticCandidates()) });
    pauseLinkedinPoolAccountForManualReview(
      run.poolRepository.getDatabase(),
      run.account.id,
      'challenge_required',
      NOW,
    );

    const report = await runPoolInvitationStep(run.dependencies);
    expect(report.status).toBe('halted');
    expect(run.dependencies.candidates).not.toHaveBeenCalled();
    expect(run.send).not.toHaveBeenCalled();
  });

  it('honours the executor backoff before reading invitation targets', async () => {
    const run = await setup({
      isBackingOff: () => true,
      candidates: vi.fn(() => syntheticCandidates()),
    });

    const report = await runPoolInvitationStep(run.dependencies);
    expect(report).toMatchObject({ status: 'blocked', reason: 'backoff' });
    expect(run.dependencies.candidates).not.toHaveBeenCalled();
    expect(run.send).not.toHaveBeenCalled();
  });

  it('resumes after the configured cooldown expires and keeps the attempt in the daily budget', async () => {
    const run = await setup({
      send: vi.fn(async () => 'failed' as const),
      candidates: () => syntheticCandidates('OneCo', 2),
      timing: { minDelayMs: 60_000, maxDelayMs: 180_000, failurePauseMs: 60_000 },
    });
    await runPoolInvitationStep(run.dependencies);

    const beforeExpiry = await runPoolInvitationStep(run.dependencies);
    expect(beforeExpiry.status).toBe('halted');
    run.now.value = new Date(NOW.getTime() + 60_001);
    const afterExpiry = await runPoolInvitationStep(run.dependencies);
    expect(run.poolRepository.findAccount(run.account.id)?.state).toBe('cooling_down');
    expect(
      run.repository.counters(run.account.id, run.now.value, new Date('2026-10-06T00:00:00.000Z'))
        .attemptedToday,
    ).toBe(2);
    expect(afterExpiry.status).toBe('halted');
  });

  it('waits a uniformly generated delay in the configured range between attempts', async () => {
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1);
    const wait = vi.fn(async (_milliseconds: number) => undefined);
    const run = await setup({
      random,
      wait,
      timing: { minDelayMs: 60_000, maxDelayMs: 180_000, failurePauseMs: 60_000 },
      candidates: () => syntheticCandidates('DifferentCo', 3),
    });

    const report = await runPoolInvitationStep(run.dependencies);
    expect(report.sent).toBe(3);
    expect(wait.mock.calls.map((call) => call[0])).toEqual([60_000, 180_000]);
  });

  it('derives account age from the pool record and maps NaN and negative ages to fresh', async () => {
    const freshRun = await setup(
      {
        accountAgeDays: () => 400,
        candidates: () => syntheticCandidates('FreshCo', 12),
      },
      '2026-10-01T12:00:00.000Z',
    );
    const fresh = await runPoolInvitationStep(freshRun.dependencies);
    expect(fresh.sent).toBe(INVITATION_LIMITS.freshDaily);

    expect(
      planInvitations({
        accountAgeDays: Number.NaN,
        attemptedLast7d: 0,
        attemptedToday: 0,
        sentLast30d: 0,
        acceptedLast30d: 0,
        pending: 0,
        restricted: false,
        windowOpen: true,
      }).allowed,
    ).toBe(INVITATION_LIMITS.freshDaily);
    expect(
      planInvitations({
        accountAgeDays: -1,
        attemptedLast7d: 0,
        attemptedToday: 0,
        sentLast30d: 0,
        acceptedLast30d: 0,
        pending: 0,
        restricted: false,
        windowOpen: true,
      }).allowed,
    ).toBe(INVITATION_LIMITS.freshDaily);
  });

  it('does not start without the external HMAC key', async () => {
    const candidatesSpy = vi.fn(() => syntheticCandidates());
    const run = await setup({ hashKey: undefined, candidates: candidatesSpy });

    const report = await runPoolInvitationStep(run.dependencies);
    expect(report).toMatchObject({ status: 'blocked', reason: 'hash_key_missing' });
    expect(candidatesSpy).not.toHaveBeenCalled();
    expect(
      run.repository.counters(run.account.id, NOW, new Date('2026-10-06T00:00:00.000Z'))
        .attemptedToday,
    ).toBe(0);
  });

  it('rejects a short HMAC key before reading candidates', async () => {
    const candidatesSpy = vi.fn(() => syntheticCandidates());
    const run = await setup({ hashKey: Buffer.alloc(31), candidates: candidatesSpy });

    expect(await runPoolInvitationStep(run.dependencies)).toMatchObject({
      status: 'blocked',
      reason: 'hash_key_invalid',
    });
    expect(candidatesSpy).not.toHaveBeenCalled();
  });

  it('keeps company caps across calls using the invitation journal', async () => {
    const run = await setup({
      candidates: () => syntheticCandidates('Same Synthetic Company', 8),
    });
    const first = await runPoolInvitationStep(run.dependencies);
    run.now.value = new Date('2026-10-07T12:00:00.000Z');
    const second = await runPoolInvitationStep(run.dependencies);

    expect(first.sent).toBe(INVITATION_LIMITS.perCompany);
    expect(second.sent).toBe(0);
    expect(
      run.repository.counters(run.account.id, run.now.value, new Date('2026-10-07T00:00:00.000Z'))
        .attemptedToday,
    ).toBe(0);
    const company = run.repository.invitedCountForCompany(run.account.id, 'same synthetic company');
    expect(company).toBe(INVITATION_LIMITS.perCompany);
  });

  it('uses HMAC-SHA256 and canonicalizes the target URL before hashing', async () => {
    const hashWithKey = hashInvitationTarget as unknown as (url: string, key: Buffer) => string;
    const first = 'HTTPS://WWW.Linkedin.com/in/Synthetic-Person/?trk=mail#top';
    const equivalent = 'https://www.linkedin.com/in/synthetic-person';
    const expected = hashWithKey(equivalent, KEY);

    expect(hashWithKey(first, KEY)).toBe(expected);
    expect(hashWithKey(equivalent, Buffer.alloc(32, 74))).not.toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{64}$/u);
    const run = await setup();
    run.repository.plan(run.account.id, first, 'Synthetic Co', 'recruiter', KEY, NOW);
    const row = run.poolRepository
      .getDatabase()
      .prepare('SELECT target_hash FROM linkedin_pool_invitations WHERE account_id = ?')
      .get(run.account.id) as { target_hash: string };
    expect(row.target_hash).toBe(expected);
    expect(row.target_hash).not.toContain('synthetic-person');
  });

  it('purges invitation journal entries after ninety days', async () => {
    const run = await setup();
    const oldAt = new Date(NOW.getTime() - 91 * 86_400_000);
    run.poolRepository
      .getDatabase()
      .prepare(
        'INSERT INTO linkedin_pool_invitations (account_id, target_hash, company, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        run.account.id,
        'a'.repeat(64),
        'OldCo',
        'recruiter',
        'failed',
        oldAt.toISOString(),
        oldAt.toISOString(),
      );
    const purged = run.repository.purgeExpired(NOW);
    const remaining = run.poolRepository
      .getDatabase()
      .prepare('SELECT COUNT(*) AS count FROM linkedin_pool_invitations WHERE account_id = ?')
      .get(run.account.id) as { count: number };

    expect(purged).toBe(1);
    expect(remaining.count).toBe(0);
  });
});
