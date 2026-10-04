import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CandidateReputationAudit } from '../../shared/candidateReputation';
import type { CandidateFootprintAudit } from '../../shared/candidateFootprint';
import { SqliteCandidateReputationRepository } from './sqliteCandidateReputationRepository';

describe('SqliteCandidateReputationRepository', () => {
  function createRepo(): {
    repo: SqliteCandidateReputationRepository;
    db: DatabaseSync;
  } {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateReputationRepository(db);
    return { repo, db };
  }

  const sampleAudit1: CandidateReputationAudit = {
    id: 'audit-1',
    candidateId: 'cand-100',
    status: 'completed',
    overallStatus: 'safe',
    score: 95,
    consistencyDiscrepancies: [],
    reputationRisks: [],
    consentAction: 'Запуск аудита цифрового следа по инициативе кандидата согласно 152-ФЗ / GDPR',
    startedAt: '2026-09-17T10:00:00.000Z',
    completedAt: '2026-09-17T10:00:05.000Z',
  };

  const sampleAudit2: CandidateReputationAudit = {
    id: 'audit-2',
    candidateId: 'cand-100',
    status: 'completed',
    overallStatus: 'attention',
    score: 72,
    consistencyDiscrepancies: [
      {
        id: 'disc-1',
        field: 'Опыт работы: Acme Corp',
        candidateValue: '2021-2023, Lead Engineer',
        externalValue: '2021-2022, Senior Engineer',
        externalSource: 'hh.ru',
        severity: 'warning',
        suggestion: 'Скорректировать дату окончания работы в профиле',
      },
    ],
    reputationRisks: [
      {
        id: 'risk-1',
        sourceUrl: 'https://example.com/post/1',
        sourcePlatform: 'Хабр',
        publishedAt: '2023-05-12',
        excerpt: 'Все процессы в отделе поломаны, руководство некомпетентно',
        category: 'toxic_workplace',
        severity: 'medium',
        remediation: 'Удалить или скрыть публикацию',
      },
    ],
    consentAction: 'Запуск аудита цифрового следа по инициативе кандидата согласно 152-ФЗ / GDPR',
    startedAt: '2026-09-17T11:00:00.000Z',
    completedAt: '2026-09-17T11:00:06.000Z',
  };

  it('возвращает null, если аудит для кандидата отсутствует', () => {
    const { repo } = createRepo();
    expect(repo.getLatestAudit('non-existent')).toBeNull();
  });

  it('сохраняет и извлекает последний аудит кандидата', () => {
    const { repo } = createRepo();
    repo.saveAudit(sampleAudit1);

    const result = repo.getLatestAudit('cand-100');
    expect(result).toEqual(sampleAudit1);
  });

  it('возвращает самый свежий аудит при наличии нескольких записей', () => {
    const { repo } = createRepo();
    repo.saveAudit(sampleAudit1);
    repo.saveAudit(sampleAudit2);

    const result = repo.getLatestAudit('cand-100');
    expect(result).toEqual(sampleAudit2);
  });

  it('lists the full candidate audit history for export', () => {
    const { repo } = createRepo();
    repo.saveAudit(sampleAudit1);
    repo.saveAudit(sampleAudit2);

    expect(repo.listAudits('cand-100').map((audit) => audit.id)).toEqual(['audit-2', 'audit-1']);
  });

  it('downgrades legacy safe/100 rows without trusted source coverage', () => {
    const { repo } = createRepo();
    repo.saveAudit({ ...sampleAudit1, id: 'legacy-safe-100', score: 100, overallStatus: 'safe' });

    expect(repo.getLatestAudit('cand-100', { trustedOnly: true })).toMatchObject({
      overallStatus: 'not_scanned',
      score: 0,
    });
  });

  it('изолирует аудиты разных кандидатов', () => {
    const { repo } = createRepo();
    repo.saveAudit(sampleAudit1);
    const candidate2Audit: CandidateReputationAudit = {
      ...sampleAudit2,
      id: 'audit-cand-2',
      candidateId: 'cand-200',
    };
    repo.saveAudit(candidate2Audit);

    expect(repo.getLatestAudit('cand-100')).toEqual(sampleAudit1);
    expect(repo.getLatestAudit('cand-200')).toEqual(candidate2Audit);
  });

  it('поддерживает инициализацию по пути к базе данных', () => {
    const repo = new SqliteCandidateReputationRepository({ databasePath: ':memory:' });
    repo.saveAudit(sampleAudit1);
    expect(repo.getLatestAudit('cand-100')).toEqual(sampleAudit1);
  });

  it('удаляет все аудиты кандидата по lifecycle-команде', () => {
    const { repo } = createRepo();
    repo.saveAudit(sampleAudit1);
    expect(repo.deleteAuditsByCandidateId('cand-100')).toBe(1);
    expect(repo.getLatestAudit('cand-100')).toBeNull();
  });

  it('cascades audits when the shared candidates row is deleted', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE candidates (id TEXT PRIMARY KEY); INSERT INTO candidates VALUES ('cand-100');`);
    const repo = new SqliteCandidateReputationRepository(db);
    repo.saveAudit(sampleAudit1);

    db.exec("DELETE FROM candidates WHERE id = 'cand-100'");

    expect(repo.getLatestAudit('cand-100')).toBeNull();
  });

  it('encrypts footprint receipts and updates review only inside the candidate-owned audit', () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateReputationRepository({
      database: db,
      encryptionKey: Buffer.alloc(32, 9),
    });
    const footprint: CandidateFootprintAudit = {
      id: 'footprint-1',
      candidateId: 'cand-100',
      state: 'completed',
      selectedQueryIds: ['plan-id'],
      adapterStatuses: [],
      findings: [{
        id: 'finding-1',
        adapter: 'exa',
        kind: 'mention',
        url: 'https://public.example/profile',
        title: 'Maria profile',
        detail: 'Public project page',
        match: 'likely_self',
        observedAt: '2026-10-04T12:00:00.000Z',
        receipt: { method: 'POST', source: 'Exa', query: 'Maria Petrova Analytical Engines' },
        receipts: [{ method: 'POST', source: 'Exa', query: 'Maria Petrova Analytical Engines' }],
        sources: ['exa'],
        automatedMatch: 'likely_self',
        review: 'unreviewed',
      }],
      ownershipConfirmedAt: '2026-10-04T12:00:00.000Z',
      startedAt: '2026-10-04T12:00:00.000Z',
      completedAt: '2026-10-04T12:00:02.000Z',
    };

    repo.saveFootprintAudit(footprint);
    const row = db.prepare(
      'SELECT payload_cipher FROM candidate_footprint_audits WHERE id = ?',
    ).get('footprint-1') as { payload_cipher: string };
    expect(row.payload_cipher).not.toContain('Maria Petrova');
    expect(repo.getLatestFootprintAudit('cand-100')).toEqual(footprint);

    expect(repo.updateFootprintFindingReview('cand-100', 'finding-1', 'confirmed_self')?.findings[0]?.review)
      .toBe('confirmed_self');
    const cleared = repo.updateFootprintFindingReview('cand-100', 'finding-1', 'unreviewed');
    expect(cleared?.findings[0]).toMatchObject({ review: 'unreviewed', match: 'likely_self' });
    expect(repo.updateFootprintFindingReview('cand-other', 'finding-1', 'not_self')).toBeNull();
    expect(repo.deleteFootprintAuditsByCandidateId('cand-100')).toBe(1);
    expect(repo.getLatestFootprintAudit('cand-100')).toBeNull();
  });
});
