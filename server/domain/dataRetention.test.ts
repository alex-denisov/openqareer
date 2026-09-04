import { describe, expect, it } from 'vitest';
import { LEGAL_CONTENT } from '../../src/features/legal/legalContent';
import {
  RETENTION_POLICIES,
  publishedRetentionRows,
  retentionCutoff,
  retentionCutoffFor,
  retentionRuleFor,
} from './dataRetention';

describe('published retention periods are the ones the code enforces', () => {
  it('reads the published table out of the policy document itself', () => {
    const rows = publishedRetentionRows(LEGAL_CONTENT.privacy);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toContainEqual([
      'записи об акцепте юридических документов',
      '3 года с даты прекращения договора',
    ]);
  });

  it('names exactly one rule for every published row, word for word', () => {
    const rows = publishedRetentionRows(LEGAL_CONTENT.privacy);
    for (const [subject, period] of rows) {
      const matching = RETENTION_POLICIES.filter((policy) => policy.subject === subject);
      expect(matching, `нет правила для «${subject}»`).toHaveLength(1);
      expect(matching[0].period, `срок «${subject}» разошёлся с документом`).toBe(period);
    }
  });

  it('keeps no rule that the published table does not name', () => {
    const published = publishedRetentionRows(LEGAL_CONTENT.privacy).map(([subject]) => subject);
    for (const policy of RETENTION_POLICIES) {
      expect(published, `правило «${policy.subject}» не опубликовано`).toContain(policy.subject);
    }
  });

  it('turns an age-bounded rule into the cutoff the sweeper deletes before', () => {
    const consent = RETENTION_POLICIES.find(
      (policy) => policy.subject === 'записи об акцепте юридических документов',
    );
    expect(consent?.rule).toEqual({
      kind: 'purge-after-contract-end',
      years: 3,
      stored: 'legal_consents',
    });
    expect(retentionCutoff(consent!.rule, '2026-09-04T00:00:00.000Z')).toBe(
      '2023-09-04T00:00:00.000Z',
    );

    const securityLog = RETENTION_POLICIES.find(
      (policy) => policy.subject === 'журналы безопасности',
    );
    expect(securityLog?.rule).toEqual({
      kind: 'purge-after-age',
      months: 12,
      stored: 'admin_audit',
    });
    expect(retentionCutoff(securityLog!.rule, '2026-09-04T00:00:00.000Z')).toBe(
      '2025-09-04T00:00:00.000Z',
    );
  });

  it('gives no cutoff to data the product keeps or never stores', () => {
    expect(
      retentionCutoff({ kind: 'while-account-active' }, '2026-09-04T00:00:00.000Z'),
    ).toBeNull();
    expect(retentionCutoff({ kind: 'kept-indefinitely' }, '2026-09-04T00:00:00.000Z')).toBeNull();
    expect(retentionCutoff({ kind: 'not-stored' }, '2026-09-04T00:00:00.000Z')).toBeNull();
  });
});

describe('reading the table out of a document that does not carry one', () => {
  it('returns nothing instead of guessing', () => {
    expect(publishedRetentionRows([])).toEqual([]);
    expect(
      publishedRetentionRows([
        { heading: '9. Сроки хранения', blocks: [{ kind: 'paragraph', text: 'без таблицы' }] },
      ]),
    ).toEqual([]);
  });

  it('gives no cutoff for an unreadable moment and no rule for an unpublished subject', () => {
    expect(
      retentionCutoff({ kind: 'purge-after-age', months: 12, stored: 'admin_audit' }, 'вчера'),
    ).toBeNull();
    expect(retentionRuleFor('данные, которых нет в документе')).toBeNull();
    expect(retentionRuleFor('журналы безопасности')).toEqual({
      kind: 'purge-after-age',
      months: 12,
      stored: 'admin_audit',
    });
  });
});

describe('cutoff by the subject the document names', () => {
  it('gives the sweeper a date only for a published, age-bounded subject', () => {
    expect(retentionCutoffFor('журналы безопасности', '2026-09-04T00:00:00.000Z')).toBe(
      '2025-09-04T00:00:00.000Z',
    );
    expect(
      retentionCutoffFor('обезличенные статистические сведения', '2026-09-04T00:00:00.000Z'),
    ).toBeNull();
    expect(retentionCutoffFor('данных, которых нет', '2026-09-04T00:00:00.000Z')).toBeNull();
  });
});
