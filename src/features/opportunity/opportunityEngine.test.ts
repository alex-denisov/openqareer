import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '../evidence/evidenceEngine';
import {
  analyzeOpportunity,
  createOpportunityRecord,
  parseOpportunity,
  recordOpportunityDecision,
  validateOpportunityInput,
} from './opportunityEngine';

const VACANCY = `
Руководитель продукта
Задачи
Формировать продуктовую стратегию и управлять кросс-функциональной командой.
Проводить исследования пользователей и отвечать за продуктовые метрики.
Требования
Опыт запуска B2B-продуктов для корпоративных клиентов.
Уверенное владение SQL и системами продуктовой аналитики.
Условия
Удалённая работа, полная занятость.
`;

const EVIDENCE: EvidenceItem[] = [
  {
    id: 'ev-01',
    kind: 'responsibility',
    sourceExcerpt: 'Формировал продуктовую стратегию и управлял командой.',
    statement: 'Формировал продуктовую стратегию и управлял командой.',
    status: 'confirmed',
    userEdited: false,
  },
  {
    id: 'ev-02',
    kind: 'result',
    sourceExcerpt: 'Запустил B2B-продукт для 12 корпоративных клиентов.',
    statement: 'Запустил B2B-продукт для 12 корпоративных клиентов.',
    status: 'confirmed',
    userEdited: false,
  },
  {
    id: 'ev-03',
    kind: 'expertise',
    sourceExcerpt: 'Работал с SQL.',
    statement: 'Работал с SQL.',
    status: 'rejected',
    userEdited: false,
  },
];

describe('opportunity engine', () => {
  it('keeps extracted tasks and requirements tied to vacancy excerpts', () => {
    const record = createOpportunityRecord(
      {
        title: 'Руководитель продукта',
        company: 'Пример',
        text: VACANCY,
        sourceLabel: 'Скопировано из вакансии',
      },
      '2026-07-30T17:00:00.000Z',
    );

    for (const item of record.parsed.items) {
      expect(VACANCY).toContain(item.sourceExcerpt);
    }
    expect(record.parsed.items.some((item) => item.kind === 'requirement')).toBe(
      true,
    );
  });

  it('keeps missing salary and publication freshness unknown', () => {
    const record = createOpportunityRecord(
      {
        title: 'Руководитель продукта',
        company: '',
        text: VACANCY,
        sourceLabel: 'Ручной ввод',
      },
      '2026-07-30T17:00:00.000Z',
    );

    expect(record.parsed.unknowns).toContain('Компенсация не указана.');
    expect(record.parsed.unknowns).toContain(
      'Дата публикации и актуальность не подтверждены.',
    );
  });

  it('uses only confirmed evidence for positive fit factors', () => {
    const record = createOpportunityRecord(
      {
        title: 'Руководитель продукта',
        company: 'Пример',
        text: VACANCY,
        sourceLabel: 'Ручной ввод',
      },
      '2026-07-30T17:00:00.000Z',
    );
    const analysis = analyzeOpportunity(record, EVIDENCE, 'clear');

    expect(analysis.matches.length).toBeGreaterThan(0);
    for (const match of analysis.matches) {
      expect(match.evidenceIds.length).toBeGreaterThan(0);
      expect(match.evidenceIds).not.toContain('ev-03');
    }
  });

  it('turns a confirmed hard conflict into Skip rather than a score', () => {
    const record = createOpportunityRecord(
      {
        title: 'Руководитель продукта',
        company: 'Пример',
        text: VACANCY,
        sourceLabel: 'Ручной ввод',
      },
      '2026-07-30T17:00:00.000Z',
    );
    const analysis = analyzeOpportunity(record, EVIDENCE, 'conflict');

    expect(analysis.recommendation).toBe('skip');
    expect(analysis.reasonCodes).toContain('hard-constraint-conflict');
  });

  it('persists a user override with its reason and timestamp', () => {
    const record = createOpportunityRecord(
      {
        title: 'Руководитель продукта',
        company: 'Пример',
        text: VACANCY,
        sourceLabel: 'Ручной ввод',
      },
      '2026-07-30T17:00:00.000Z',
    );
    const analyzed = {
      ...record,
      analysis: analyzeOpportunity(record, EVIDENCE, 'clear'),
    };
    const decided = recordOpportunityDecision(
      analyzed,
      'network',
      'Сначала хочу проверить scope роли у нанимающего менеджера.',
      '2026-07-30T17:10:00.000Z',
    );

    expect(decided.decision).toEqual({
      choice: 'network',
      reason: 'Сначала хочу проверить scope роли у нанимающего менеджера.',
      decidedAt: '2026-07-30T17:10:00.000Z',
      overridesRecommendation:
        analyzed.analysis.recommendation !== 'network',
    });
  });

  it('validates title, full text and source URL with recoverable errors', () => {
    expect(
      validateOpportunityInput({
        title: '',
        company: '',
        text: 'коротко',
        sourceLabel: 'Ручной ввод',
        sourceUrl: 'ftp://example.com/job',
      }),
    ).toEqual({
      title: 'Укажите название роли из вакансии.',
      text: 'Добавьте полный текст вакансии — минимум 120 знаков.',
      sourceUrl: 'Укажите ссылку, начинающуюся с http:// или https://.',
    });
    expect(
      validateOpportunityInput({
        title: 'Product Lead',
        company: '',
        text: VACANCY,
        sourceLabel: 'Ручной ввод',
        sourceUrl: 'https://example.com/job',
      }),
    ).toEqual({});
  });

  it('classifies free-form lines and reports only genuinely missing fields', () => {
    const parsed = parseOpportunity(`
Develop product strategy and lead discovery.
5+ years of relevant experience required.
Salary $150000, remote, full-time contract.
`);

    expect(parsed.items.map((item) => item.kind)).toEqual([
      'task',
      'requirement',
      'condition',
    ]);
    expect(parsed.unknowns).toEqual([
      'Дата публикации и актуальность не подтверждены.',
    ]);
  });

  it('distinguishes Apply, Network and Watch without a numerical score', () => {
    const fullyCoveredRecord = createOpportunityRecord(
      {
        title: 'Руководитель продукта',
        company: 'Пример',
        text: `
Требования
Формировать продуктовую стратегию и управлять командой.
Запускать B2B-продукты для корпоративных клиентов.
Условия
Удалённая работа, полная занятость.
`,
        sourceLabel: 'Ручной ввод',
      },
      '2026-07-30T17:00:00.000Z',
    );
    const apply = analyzeOpportunity(fullyCoveredRecord, EVIDENCE, 'clear');
    const network = analyzeOpportunity(fullyCoveredRecord, EVIDENCE, 'unknown');
    const watch = analyzeOpportunity(fullyCoveredRecord, [], 'clear');

    expect(apply.recommendation).toBe('apply');
    expect(network.recommendation).toBe('network');
    expect(watch.recommendation).toBe('watch');
  });

  it('rejects an unexplained final decision', () => {
    const record = createOpportunityRecord(
      {
        title: 'Руководитель продукта',
        company: '',
        text: VACANCY,
        sourceLabel: '',
      },
      '2026-07-30T17:00:00.000Z',
    );
    const analyzed = {
      ...record,
      analysis: analyzeOpportunity(record, EVIDENCE, 'unknown'),
    };

    expect(record.sourceLabel).toBe('Ручной ввод');
    expect(() =>
      recordOpportunityDecision(analyzed, 'watch', 'мало'),
    ).toThrow('Добавьте короткую причину решения.');
  });
});
