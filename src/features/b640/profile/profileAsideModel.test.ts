import { describe, expect, it } from 'vitest';
import type { SearchConditionsDraft } from '../../career-map/careerScreenTypes';
import {
  answerLabel,
  moreVersionsLabel,
  searchRole,
  termsRows,
  termsSummary,
  versionDate,
  versionTag,
} from './profileAsideModel';

function conditions(
  amount: number | null,
  places: readonly string[],
  format: SearchConditionsDraft['format'],
): SearchConditionsDraft {
  return {
    geography: { selected: places, isRelocationEnabled: false },
    salaryFrom: { amountRubles: amount, showWithoutSalary: true },
    format,
    stopList: [],
  };
}

describe('s01 правая колонка', () => {
  it('условия поиска: роль, деньги, где и формат как в макете', () => {
    const rows = termsRows(
      ['Руководитель разработки', 'CTO'],
      conditions(500_000, ['Москва'], { office: false, hybrid: true, remote: true }),
    );
    expect(rows).toEqual([
      { label: 'Роль', value: 'Руководитель разработки' },
      { label: 'Деньги', value: 'от 500 000 ₽ на руки' },
      { label: 'Где', value: 'Москва' },
      { label: 'Формат', value: 'удалённо или гибрид' },
    ]);
    expect(termsSummary(rows)).toBe('Руководитель разработки · от 500 000 ₽ на руки · Москва');
  });

  it('условия без значения не показываются', () => {
    const rows = termsRows(
      [],
      conditions(null, [], { office: false, hybrid: false, remote: false }),
    );
    expect(rows).toEqual([]);
    expect(termsSummary(rows)).toBe('');
  });

  it('метка резюме по статусу и дата', () => {
    expect(versionTag('draft')).toEqual({ tone: 'part', text: 'черновик' });
    expect(versionTag('approved')).toEqual({ tone: 'ok', text: 'одобрено' });
    expect(versionTag('sent')).toEqual({ tone: 'ok', text: 'отправлено' });
    expect(versionDate('2026-11-10T09:00:00.000Z')).toBe('10 ноября');
    expect(versionDate('нет даты')).toBeNull();
  });

  it('подписи с числом склоняются', () => {
    expect(answerLabel(1)).toBe('Ответить на 1 вопрос');
    expect(answerLabel(3)).toBe('Ответить на 3 вопроса');
    expect(moreVersionsLabel(14, 3)).toBe('Ещё 11 — в «Откликах»');
    expect(moreVersionsLabel(3, 3)).toBeNull();
  });
});

describe('B645 23.11: роль поиска в s01', () => {
  const titlesRu = { 'VP of Engineering / Technology': 'Руководитель разработки (VP)' };

  it('роль, названная платформой (модель или онтология), — по-русски, как на «Карьере»', () => {
    expect(
      searchRole({ value: ['VP of Engineering / Technology'], origin: 'explicit' }, titlesRu),
    ).toBe('Руководитель разработки (VP)');
    expect(
      searchRole({ value: ['VP of Engineering / Technology'], origin: 'model' }, titlesRu),
    ).toBe('Руководитель разработки (VP)');
  });

  it('роль из резюме кандидата и роль без русского названия — как есть', () => {
    expect(
      searchRole({ value: ['VP of Engineering / Technology'], origin: 'profile' }, titlesRu),
    ).toBe('VP of Engineering / Technology');
    expect(searchRole({ value: ['Head of Ops'], origin: 'explicit' }, titlesRu)).toBe(
      'Head of Ops',
    );
    expect(searchRole({ value: [], origin: 'default' }, titlesRu)).toBeNull();
  });
});
