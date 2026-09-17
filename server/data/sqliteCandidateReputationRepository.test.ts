import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CandidateReputationAudit } from '../../shared/candidateReputation';
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
});
