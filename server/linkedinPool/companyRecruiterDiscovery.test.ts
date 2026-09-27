import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';
import {
  findCompanyRecruitersFromPool,
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
