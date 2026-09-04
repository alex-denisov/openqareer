import type { LegalSection } from '../../src/features/legal/legalContent';

/**
 * PRB-014 / B195 — раздел 9 политики опубликован и обещает сроки хранения.
 * Пока эти сроки жили только в тексте, продукт хранил дольше обещанного.
 * Здесь каждая строка опубликованной таблицы названа исполнимым правилом, а
 * тест сверяет два списка дословно: правка срока в документе роняет тест, пока
 * не поправлен код.
 */
export type RetentionRule =
  /** Живёт, пока жив аккаунт: удаление аккаунта уносит данные каскадом. */
  | { readonly kind: 'while-account-active' }
  /** Переживает аккаунт ради доказательства, но не дольше срока. */
  | {
      readonly kind: 'purge-after-contract-end';
      readonly years: number;
      readonly stored: string;
    }
  /** Считается от даты самой записи. */
  | {
      readonly kind: 'purge-after-age';
      readonly months: number;
      readonly stored: string;
    }
  /** Таких данных продукт не хранит — уборке нечего удалять. */
  | { readonly kind: 'not-stored' }
  /** Обезличенные сведения: срока нет. */
  | { readonly kind: 'kept-indefinitely' };

export interface RetentionPolicy {
  /** Дословно предмет из опубликованной таблицы. */
  readonly subject: string;
  /** Дословно срок из опубликованной таблицы. */
  readonly period: string;
  readonly rule: RetentionRule;
}

const RETENTION_HEADING = '9. Сроки хранения';

export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  {
    subject: 'аккаунт, профиль и карьерные ответы',
    period: 'пока активен аккаунт',
    rule: { kind: 'while-account-active' },
  },
  {
    subject: 'резюме, документы и факты профиля',
    period: 'пока активен аккаунт или до удаления пользователем',
    rule: { kind: 'while-account-active' },
  },
  {
    subject: 'переписка с карьерным экспертом',
    period: 'пока активен аккаунт или до удаления пользователем',
    rule: { kind: 'while-account-active' },
  },
  {
    subject: 'записи об акцепте юридических документов',
    period: '3 года с даты прекращения договора',
    rule: { kind: 'purge-after-contract-end', years: 3, stored: 'legal_consents' },
  },
  {
    // Платежи не подключены: событий и учётных документов в продукте нет.
    subject: 'платёжные события и документы учёта',
    period: 'не менее 5 лет в силу требований законодательства',
    rule: { kind: 'not-stored' },
  },
  {
    subject: 'журналы безопасности',
    period: 'до 12 месяцев',
    rule: { kind: 'purge-after-age', months: 12, stored: 'admin_audit' },
  },
  {
    // Канала обращений в продукте нет: поддержка идёт почтой оператора.
    subject: 'обращения в поддержку',
    period: 'до 3 лет',
    rule: { kind: 'not-stored' },
  },
  {
    subject: 'обезличенные статистические сведения',
    period: 'бессрочно',
    rule: { kind: 'kept-indefinitely' },
  },
];

/** Читает таблицу сроков из самого опубликованного документа. */
export function publishedRetentionRows(
  document: readonly LegalSection[],
): readonly (readonly [string, string])[] {
  const section = document.find((item) => item.heading === RETENTION_HEADING);
  if (!section) return [];
  const table = section.blocks.find((block) => block.kind === 'table');
  return table && table.kind === 'table' ? table.rows : [];
}

/**
 * Момент, раньше которого запись хранить больше нечем оправдать. `null` —
 * у правила нет срока, уборка его не трогает.
 */
export function retentionCutoff(rule: RetentionRule, now: string): string | null {
  const moment = new Date(now);
  if (Number.isNaN(moment.getTime())) return null;

  if (rule.kind === 'purge-after-contract-end') {
    const cutoff = new Date(moment);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - rule.years);
    return cutoff.toISOString();
  }
  if (rule.kind === 'purge-after-age') {
    const cutoff = new Date(moment);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - rule.months);
    return cutoff.toISOString();
  }
  return null;
}

/** Правило по предмету — чтобы уборщик не переписывал сроки своими числами. */
export function retentionRuleFor(subject: string): RetentionRule | null {
  return RETENTION_POLICIES.find((policy) => policy.subject === subject)?.rule ?? null;
}

/**
 * Срок уборки по предмету из документа. Незнакомый предмет не даёт уборщику
 * права удалять: `null` — «сроку взяться неоткуда, ничего не трогаем».
 */
export function retentionCutoffFor(subject: string, now: string): string | null {
  const rule = retentionRuleFor(subject);
  return rule ? retentionCutoff(rule, now) : null;
}
