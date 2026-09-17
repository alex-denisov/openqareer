import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CandidateReputationAudit } from '../../../shared/candidateReputation';
import { CandidateReputationAuditView } from './CandidateReputationAuditView';

describe('CandidateReputationAuditView', () => {
  const sampleSafeAudit: CandidateReputationAudit = {
    id: 'audit-safe-1',
    candidateId: 'cand-1',
    status: 'completed',
    overallStatus: 'safe',
    score: 100,
    consistencyDiscrepancies: [],
    reputationRisks: [],
    consentAction: 'Запуск аудита цифрового следа по инициативе кандидата согласно 152-ФЗ / GDPR',
    startedAt: '2026-09-17T10:00:00.000Z',
    completedAt: '2026-09-17T10:00:02.000Z',
  };

  const sampleRiskAudit: CandidateReputationAudit = {
    id: 'audit-risk-2',
    candidateId: 'cand-1',
    status: 'completed',
    overallStatus: 'critical_risk',
    score: 45,
    consistencyDiscrepancies: [
      {
        id: 'd-1',
        field: 'Дата окончания: Acme Corp',
        candidateValue: '2023-01',
        externalValue: '2022-01',
        externalSource: 'hh.ru',
        severity: 'warning',
        suggestion: 'Скорректировать дату окончания работы в профиле hh.ru',
      },
    ],
    reputationRisks: [
      {
        id: 'r-1',
        sourcePlatform: 'Habr',
        sourceUrl: 'https://habr.com/p/1',
        publishedAt: '2023-05-12',
        excerpt: 'Все процессы поломаны, руководство — кидалы',
        category: 'toxic_workplace',
        severity: 'high',
        remediation: 'Удалить или скрыть эмоциональную публикацию о работодателе',
      },
    ],
    consentAction: 'Запуск аудита цифрового следа по инициативе кандидата согласно 152-ФЗ / GDPR',
    startedAt: '2026-09-17T10:00:00.000Z',
    completedAt: '2026-09-17T10:00:03.000Z',
  };

  it('отображает экран до запуска с кнопкой и юридическим согласием 152-ФЗ / GDPR', () => {
    const html = renderToStaticMarkup(
      <CandidateReputationAuditView candidateId="cand-1" initialAudit={null} />,
    );
    expect(html).toContain('Запустить аудит цифрового следа и репутации');
    expect(html).toContain('152-ФЗ и GDPR');
    expect(html).toContain('Поиск проводится исключительно по открытым публичным источникам');
  });

  it('отображает индикатор серверного анализа при состоянии загрузки', () => {
    const html = renderToStaticMarkup(
      <CandidateReputationAuditView
        candidateId="cand-1"
        initialAudit={null}
        initialRunning={true}
      />,
    );
    expect(html).toContain('Серверный анализ открытых источников');
  });

  it('отображает безопасный аудит с оценкой 100 и чистым следом', () => {
    const html = renderToStaticMarkup(
      <CandidateReputationAuditView
        candidateId="cand-1"
        initialAudit={sampleSafeAudit}
      />,
    );
    expect(html).toContain('Безопасно');
    expect(html).toContain('100');
    expect(html).toContain('Расхождений в датах и должностях между внешними профилями не обнаружено');
    expect(html).toContain('Потенциально компрометирующих публикаций и токсичных высказываний не обнаружено');
    expect(html).toContain('Запустить повторный анализ');
  });

  it('отображает критический статус, расхождения и рекомендации исправления', () => {
    const html = renderToStaticMarkup(
      <CandidateReputationAuditView
        candidateId="cand-1"
        initialAudit={sampleRiskAudit}
      />,
    );
    expect(html).toContain('Критический риск');
    expect(html).toContain('45');
    expect(html).toContain('Дата окончания: Acme Corp');
    expect(html).toContain('Скорректировать дату окончания работы в профиле hh.ru');
    expect(html).toContain('Все процессы поломаны, руководство — кидалы');
    expect(html).toContain('Удалить или скрыть эмоциональную публикацию о работодателе');
  });

  it('отображает сообщение об ошибке, если передан initialError', () => {
    const html = renderToStaticMarkup(
      <CandidateReputationAuditView
        candidateId="cand-1"
        initialAudit={null}
        initialError="Сетевой сбой при получении отчета"
      />,
    );
    expect(html).toContain('Сетевой сбой при получении отчета');
  });
});
