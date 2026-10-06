import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqlitePoolInvitationRepository } from '../data/sqlitePoolInvitationRepository';
import { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';
import { INVITATION_LIMITS } from './invitationBudgetPolicy';
import {
  readPoolInvitationsEnabled,
  runPoolInvitationStep,
  type InvitationSendOutcome,
  type InvitationStepDependencies,
} from './poolInvitationStep';

const TZ = 'UTC';
const KEY = Buffer.alloc(32, 17);
const ACTOR = { actorUserId: 'invitation-test', actorUsername: 'invitation.test' };
const noon = () => new Date('2026-10-06T12:00:00Z');
const resources: Array<{ repository: SqliteLinkedinPoolRepository; directory: string }> = [];
const candidates = Array.from({ length: 12 }, (_, i) => ({
  profileUrl: 'https://www.linkedin.com/in/synthetic-person-' + i,
  company: 'Co' + (i % 4),
  kind: 'recruiter' as const,
}));

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.repository.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

async function setup(overrides: Partial<InvitationStepDependencies> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-b374-invitations-'));
  const poolRepository = new SqliteLinkedinPoolRepository({
    databasePath: ':memory:',
    encryptionKey: KEY,
    runtimeRoot: join(directory, 'runtime'),
    now: () => new Date('2025-08-01T12:00:00Z'),
  });
  const created = poolRepository.create({
    adminLabel: 'Тестовый искусственный аккаунт',
    emailLogin: 'synthetic-pool@example.test',
    providerAccountMarker: 'synthetic-b374',
    idempotencyKey: 'b374d000-0000-4000-8000-000000000001',
    ...ACTOR,
  }).account;
  const login = await poolRepository.beginLogin(created.id, ACTOR);
  await poolRepository.completeLogin(created.id, login.lease.handle, {
    state: 'ready',
    accountMarker: 'synthetic-b374',
  });
  resources.push({ repository: poolRepository, directory });
  const repository = new SqlitePoolInvitationRepository(poolRepository.getDatabase());
  const send = vi.fn(async (_url: string): Promise<InvitationSendOutcome> => 'sent');
  const deps: InvitationStepDependencies = {
    enabled: true,
    accountId: created.id,
    timezone: TZ,
    repository,
    hashKey: KEY,
    isHalted: () => false,
    isBackingOff: () => false,
    candidates: () => candidates,
    send,
    onPlatformSignal: vi.fn(),
    now: noon,
    timing: { delayMinMs: 1, delayMaxMs: 1, failurePauseMs: 60_000 },
    random: () => 0,
    wait: async () => undefined,
    ...overrides,
  };
  return { deps, send, repository, poolRepository };
}

describe('флаг', () => {
  it('по умолчанию выключен, мусор отвергается', () => {
    expect(readPoolInvitationsEnabled({})).toBe(false);
    expect(
      readPoolInvitationsEnabled({ OPENQAREER_LINKEDIN_POOL_INVITATIONS_ENABLED: 'true' }),
    ).toBe(true);
    expect(() =>
      readPoolInvitationsEnabled({ OPENQAREER_LINKEDIN_POOL_INVITATIONS_ENABLED: 'yes' }),
    ).toThrow();
  });

  it('выключен: ноль вызовов отправки и кандидатов', async () => {
    const candidatesSpy = vi.fn(() => candidates);
    const { deps, send } = await setup({ enabled: false, candidates: candidatesSpy });
    expect((await runPoolInvitationStep(deps)).status).toBe('disabled');
    expect(send).not.toHaveBeenCalled();
    expect(candidatesSpy).not.toHaveBeenCalled();
  });
});

describe('остановка', () => {
  it('B395/пауза до старта: ноль приглашений', async () => {
    const { deps, send } = await setup({ isHalted: () => true });
    expect((await runPoolInvitationStep(deps)).status).toBe('halted');
    expect(send).not.toHaveBeenCalled();
  });

  it('остановка посреди шага прекращает отправку', async () => {
    let halted = false;
    const { deps, send } = await setup({ isHalted: () => halted });
    send.mockImplementation(async () => {
      halted = true;
      return 'sent';
    });
    const report = await runPoolInvitationStep(deps);
    expect(send).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ status: 'halted', sent: 1 });
  });

  it('challenge: статус failed, сигнал наружу, дальше не шлём', async () => {
    const onPlatformSignal = vi.fn();
    const { deps, send } = await setup({ onPlatformSignal });
    send.mockResolvedValue('challenge');
    const report = await runPoolInvitationStep(deps);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onPlatformSignal).toHaveBeenCalledWith('challenge');
    expect(report.status).toBe('halted');
  });
});

describe('политика и учёт на фейковых часах', () => {
  it('дневной потолок, затем блок до следующих суток', async () => {
    const { deps, send } = await setup();
    const first = await runPoolInvitationStep(deps);
    expect(first.sent).toBe(INVITATION_LIMITS.matureDaily);
    expect(send).toHaveBeenCalledTimes(INVITATION_LIMITS.matureDaily);
    const again = await runPoolInvitationStep(deps);
    expect(again).toMatchObject({ status: 'blocked', reason: 'daily_cap' });
    const next = await runPoolInvitationStep({
      ...deps,
      now: () => new Date('2026-10-07T12:00:00Z'),
    });
    expect(next.sent).toBeGreaterThan(0);
  });

  it('недельный потолок ниже лимита платформы', async () => {
    const { deps, repository } = await setup();
    for (let day = 0; day < 6; day += 1) {
      const now = () => new Date(Date.UTC(2026, 9, 6 + day, 12));
      await runPoolInvitationStep({ ...deps, now });
    }
    const total = repository.counters(
      deps.accountId,
      new Date('2026-10-11T13:00:00Z'),
      new Date('2026-10-11T00:00:00Z'),
    );
    expect(total.attemptedLast7d).toBeLessThanOrEqual(INVITATION_LIMITS.matureWeekly);
    expect(total.attemptedLast7d).toBeLessThan(INVITATION_LIMITS.platformWeekly);
  });

  it('вне окна активности не шлёт; одну цель не приглашает дважды', async () => {
    const { deps, send } = await setup({ now: () => new Date('2026-10-06T03:00:00Z') });
    expect(await runPoolInvitationStep(deps)).toMatchObject({
      status: 'blocked',
      reason: 'outside_window',
    });
    expect(send).not.toHaveBeenCalled();
    const second = await setup();
    await runPoolInvitationStep(second.deps);
    await runPoolInvitationStep({ ...second.deps, now: () => new Date('2026-10-07T12:00:00Z') });
    const urls = second.send.mock.calls.map((c) => c[0]);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('отчёт по компаниям: доля принявших из доставленных, без ПДн в таблице', async () => {
    const { deps, repository } = await setup();
    await runPoolInvitationStep(deps);
    const now = noon();
    const id = repository.plan(
      deps.accountId,
      'https://www.linkedin.com/in/synthetic-x',
      'Co0',
      'hub',
      KEY,
      now,
    ) as number;
    repository.setStatus(id, 'accepted', now);
    const report = repository.visibilityByCompany(deps.accountId);
    const co0 = report.find((row) => row.company === 'Co0');
    expect(co0).toMatchObject({ accepted: 1 });
    expect(co0!.share).toBeGreaterThan(0);
    expect(co0!.share).toBeLessThanOrEqual(1);
  });
});
