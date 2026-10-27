import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SqliteRecruiterContactsRepository } from '../data/sqliteRecruiterContactsRepository';
import { runRecruiterIntelligenceJobs } from './recruiterIntelligenceWorker';

describe('recruiter intelligence worker', () => {
  it('processes a queued job outside the route and stores the result', async () => {
    const database = new DatabaseSync(':memory:');
    const repository = new SqliteRecruiterContactsRepository(database);
    repository.enqueueJob('candidate-a', 'vac-1');

    const result = await runRecruiterIntelligenceJobs({
      repository,
      resolveVacancy: () => ({
        id: 'vac-1',
        company: 'Acme Corp',
        title: 'Product Manager',
        url: 'https://careers.acme.example/jobs/1',
        description: 'Recruiter: Anna Petrova; email anna.petrova@acme.example',
      }),
    });

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(repository.getJob('candidate-a', 'vac-1')).toMatchObject({ status: 'ready' });
    expect(repository.getContactsByVacancyId('candidate-a', 'vac-1')).toHaveLength(1);
    repository.close();
  });

  it('processes job via linkedinPool fallback when text has no contact signals and pool has ready account', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { SqliteLinkedinPoolRepository } = await import('../linkedinPool/sqliteLinkedinPoolRepository');
    const { savePoolCompanyRecruiter } = await import('../linkedinPool/companyRecruiterDiscovery');

    const database = new DatabaseSync(':memory:');
    const repository = new SqliteRecruiterContactsRepository(database);
    repository.enqueueJob('candidate-b', 'vac-pool-1');

    const poolDir = mkdtempSync(join(tmpdir(), 'pool-worker-test-'));
    const linkedinPool = new SqliteLinkedinPoolRepository({
      databasePath: join(poolDir, 'pool.db'),
      encryptionKey: Buffer.alloc(32, 1),
      runtimeRoot: join(poolDir, 'runtime'),
    });
    const created = linkedinPool.create({
      adminLabel: 'Test',
      emailLogin: 'test@example.com',
      providerAccountMarker: 'm-1',
      idempotencyKey: 'pool-test-idempotency',
      actorUserId: 'admin',
      actorUsername: 'admin',
    });
    linkedinPool.getDatabase().prepare("UPDATE linkedin_pool_accounts SET state = 'ready' WHERE id = ?").run(created.account.id);

    savePoolCompanyRecruiter(linkedinPool, {
      companyName: 'NovaTech',
      fullName: 'Виктор Васильев',
      roleTitle: 'Lead Recruiter',
      linkedinUrl: 'https://linkedin.com/in/victor-vasiliev',
    });

    const result = await runRecruiterIntelligenceJobs({
      repository,
      linkedinPool,
      resolveVacancy: () => ({
        id: 'vac-pool-1',
        company: 'NovaTech',
        title: 'Senior Frontend',
        description: 'Мы ищем сильного инженера. Стек React, TypeScript.',
      }),
    });

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(repository.getJob('candidate-b', 'vac-pool-1')).toMatchObject({ status: 'ready' });
    const contacts = repository.getContactsByVacancyId('candidate-b', 'vac-pool-1');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].fullName).toBe('Виктор Васильев');
    expect(contacts[0].sourceType).toBe('linkedin_pool');
    expect(contacts[0].sourceReceipt?.source).toBe('linkedin_pool');

    linkedinPool.close();
    rmSync(poolDir, { recursive: true, force: true });
    repository.close();
  });
  it('finds a recruiter on the open web with a domain email hypothesis when LinkedIn gives nothing', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { SqliteLinkedinPoolRepository } = await import('../linkedinPool/sqliteLinkedinPoolRepository');
    const { FootprintRequestGate } = await import('../osint/adapters/requestScheduler');

    const database = new DatabaseSync(':memory:');
    const repository = new SqliteRecruiterContactsRepository(database);
    repository.enqueueJob('candidate-c', 'vac-web-1');
    const poolDir = mkdtempSync(join(tmpdir(), 'open-web-worker-test-'));
    const linkedinPool = new SqliteLinkedinPoolRepository({
      databasePath: join(poolDir, 'pool.db'),
      encryptionKey: Buffer.alloc(32, 2),
      runtimeRoot: join(poolDir, 'runtime'),
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ results: [{
      url: 'https://www.linkedin.com/in/anna-smith',
      title: 'Anna Smith',
      text: '# Anna Smith\nTalent Acquisition Partner at Acme\nLondon, United Kingdom (GB)',
    }] }), { status: 200 }));

    const result = await runRecruiterIntelligenceJobs({
      repository,
      linkedinPool,
      openWeb: {
        apiKey: 'test-key',
        fetch,
        requestGate: new FootprintRequestGate({ intervalMs: 0 }),
        resolveMx: async (domain) => (domain === 'acme.com' ? [{ exchange: 'mx.acme.com', priority: 1 }] : []),
      },
      resolveVacancy: () => ({
        id: 'vac-web-1',
        company: 'Acme',
        title: 'Engineering Manager',
        url: 'https://acme.wd1.myworkdayjobs.com/jobs/1',
        description: 'Build great products.',
      }),
    });

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 });
    const [contact] = repository.getContactsByVacancyId('candidate-c', 'vac-web-1');
    expect(contact).toMatchObject({
      fullName: 'Anna Smith',
      email: 'anna.smith@acme.com',
      emailStatus: 'hypothesis',
      linkedinUrl: 'https://www.linkedin.com/in/anna-smith',
      sourceType: 'company_osint',
    });
    expect(contact.sourceReceipt?.sourceUrl).toBe('https://www.linkedin.com/in/anna-smith');
    expect(contact.channels?.map((channel) => `${channel.kind}:${channel.status}`)).toEqual([
      'email_corporate:hypothesis',
      'linkedin:published',
    ]);

    linkedinPool.close();
    rmSync(poolDir, { recursive: true, force: true });
    repository.close();
  });

  it('puts the job back in the queue when the database is busy', async () => {
    const database = new DatabaseSync(':memory:');
    const repository = new SqliteRecruiterContactsRepository(database);
    repository.enqueueJob('candidate-d', 'vac-busy');
    const saveContacts = repository.saveContacts.bind(repository);
    let calls = 0;
    repository.saveContacts = ((...args: Parameters<typeof saveContacts>) => {
      calls += 1;
      if (calls === 1) throw new Error('database is locked');
      return saveContacts(...args);
    }) as typeof repository.saveContacts;
    const resolveVacancy = () => ({ id: 'vac-busy', company: 'Acme', title: 'PM', description: 'Recruiter: Anna Petrova' });

    const first = await runRecruiterIntelligenceJobs({ repository, resolveVacancy });
    expect(first.failed).toBe(0);
    expect(repository.getJob('candidate-d', 'vac-busy')?.status).toBe('queued');

    await runRecruiterIntelligenceJobs({ repository, resolveVacancy });
    expect(repository.getJob('candidate-d', 'vac-busy')?.status).toBe('ready');
    repository.close();
  });
});
