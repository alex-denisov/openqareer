import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';
import {
  findCompanyRecruitersFromPool,
  purgeExpiredRecruiters,
  savePoolCompanyRecruiter,
} from './companyRecruiterDiscovery';

const actor = { actorUserId: 'admin-user', actorUsername: 'admin.test' };
const encryptionKey = Buffer.alloc(32, 19);
const resources: Array<{ repository: SqliteLinkedinPoolRepository; directory: string }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.repository.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-company-recruiter-'));
  const repository = new SqliteLinkedinPoolRepository({
    databasePath: join(directory, 'app.db'),
    encryptionKey,
    runtimeRoot: join(directory, 'runtime'),
  });
  resources.push({ repository, directory });
  return { repository, directory };
}

describe('companyRecruiterDiscovery', () => {
  it('purges only expired rows in bounded batches and refreshes a repeated observation', () => {
    const { repository } = createRepository();
    const profile = { companyName: 'Acme', fullName: 'Private Name', roleTitle: 'Recruiter', linkedinUrl: 'https://linkedin.com/in/private' };
    const old = '2025-01-01T00:00:00.000Z';
    const now = new Date('2026-09-29T12:00:00.000Z');
    savePoolCompanyRecruiter(repository, { ...profile, observedAt: old });
    savePoolCompanyRecruiter(repository, { ...profile, linkedinUrl: 'https://linkedin.com/in/second', observedAt: old });
    savePoolCompanyRecruiter(repository, { ...profile, linkedinUrl: 'https://linkedin.com/in/third', observedAt: old });
    const refreshed = savePoolCompanyRecruiter(repository, { ...profile, observedAt: now.toISOString() });
    const delayed = savePoolCompanyRecruiter(repository, { ...profile, observedAt: old });
    expect(delayed.observedAt).toBe(now.toISOString());
    const db = repository.getDatabase();
    expect(db.prepare('SELECT count(*) AS count FROM linkedin_pool_company_recruiters').get()).toMatchObject({ count: 3 });
    expect(db.prepare('SELECT observed_at FROM linkedin_pool_company_recruiters WHERE id = ?').get(refreshed.id)).toMatchObject({ observed_at: now.toISOString() });
    expect(purgeExpiredRecruiters(db, now, 1)).toBe(1);
    expect(db.prepare('SELECT count(*) AS count FROM linkedin_pool_company_recruiters').get()).toMatchObject({ count: 2 });
    expect(purgeExpiredRecruiters(db, now, 1)).toBe(1);
    expect(purgeExpiredRecruiters(db, now, 1)).toBe(0);
    expect(db.prepare('SELECT count(*) AS count FROM linkedin_pool_company_recruiters').get()).toMatchObject({ count: 1 });
  });

  it('соблюдает антибан: возвращает null, если в пуле нет аккаунтов со статусом ready', async () => {
    const { repository } = createRepository();

    savePoolCompanyRecruiter(repository, {
      companyName: 'Acme Corp',
      fullName: 'Анна Смирнова',
      roleTitle: 'Talent Acquisition',
      linkedinUrl: 'https://linkedin.com/in/anna-smirnova',
    });

    // В пуле нет аккаунтов вообще
    const resultNoAccounts = await findCompanyRecruitersFromPool('Acme Corp', undefined, repository);
    expect(resultNoAccounts).toBeNull();

    // Добавляем аккаунт, но он в состоянии draft (не ready)
    repository.create({
      adminLabel: 'Тестовый аккаунт',
      emailLogin: 'test@example.com',
      providerAccountMarker: 'marker-draft',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      ...actor,
    });

    const resultDraftOnly = await findCompanyRecruitersFromPool('Acme Corp', undefined, repository);
    expect(resultDraftOnly).toBeNull();
  });

  it('находит рекрутера компании в пуле, когда есть активный готовый аккаунт', async () => {
    const { repository } = createRepository();

    // Создаем аккаунт со статусом ready
    const created = repository.create({
      adminLabel: 'Рабочий аккаунт',
      emailLogin: 'worker@example.com',
      providerAccountMarker: 'marker-ready',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
      ...actor,
    });
    repository.getDatabase().prepare("UPDATE linkedin_pool_accounts SET state = 'ready' WHERE id = ?").run(created.account.id);

    savePoolCompanyRecruiter(repository, {
      companyName: 'Expired Corp',
      fullName: 'Старый контакт',
      roleTitle: 'Recruiter',
      linkedinUrl: 'https://linkedin.com/in/expired',
      observedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(await findCompanyRecruitersFromPool('Expired Corp', undefined, repository)).toBeNull();

    savePoolCompanyRecruiter(repository, {
      companyName: 'Kaspersky',
      fullName: 'Елена Морозова',
      roleTitle: 'Tech Recruiter',
      linkedinUrl: 'https://linkedin.com/in/elena-morozova',
    });

    const result = await findCompanyRecruitersFromPool('kaspersky', undefined, repository);
    expect(result).not.toBeNull();
    expect(result?.fullName).toBe('Елена Морозова');
    expect(result?.roleTitle).toBe('Tech Recruiter');
    expect(result?.sourcePlatform).toBe('linkedin_pool');
    expect(result?.linkedinUrl).toBe('https://linkedin.com/in/elena-morozova');
  });

  it('возвращает null, если рекрутер для компании не найден', async () => {
    const { repository } = createRepository();

    const created = repository.create({
      adminLabel: 'Рабочий аккаунт',
      emailLogin: 'worker@example.com',
      providerAccountMarker: 'marker-ready-2',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
      ...actor,
    });
    repository.getDatabase().prepare("UPDATE linkedin_pool_accounts SET state = 'ready' WHERE id = ?").run(created.account.id);

    const result = await findCompanyRecruitersFromPool('Unknown Corp', undefined, repository);
    expect(result).toBeNull();
  });
});
