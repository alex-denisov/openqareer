import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../../coach/cabinetTypes';
import {
  fitTierWord,
  moneyView,
  pluralRu,
  remoteLabel,
  rowDate,
  rowFormat,
  rowGeo,
  safeHttpUrl,
  vacanciesWord,
} from './format';

function item(cluster: Record<string, unknown>): MatchedVacancyItem {
  return {
    cluster: {
      id: 'c1',
      canonicalTitle: 'Руководитель разработки',
      canonicalCompany: 'Ладога Банк',
      isRemote: false,
      primaryUrl: 'https://example.com/v/1',
      sources: [],
      firstObservedAt: '2026-11-11T08:00:00Z',
      ...cluster,
    },
    explanation: { clusterId: 'c1' },
  } as unknown as MatchedVacancyItem;
}

const RATES = { date: '2026-11-10', rubPerUnit: { USD: 90.8, EUR: 98.4 } };

describe('format: строка вакансии B640', () => {
  it('дата — «дд.мм», для другого года — с годом', () => {
    const now = new Date('2026-11-16T10:00:00Z');
    expect(rowDate(item({}), now)).toBe('11.11');
    expect(rowDate(item({ firstObservedAt: '2025-11-10T08:00:00Z' }), now)).toBe('10.11.2025');
    expect(rowDate(item({ firstObservedAt: 'нет' }), now)).toBe('');
  });

  it('удалёнка подписана через «·»', () => {
    expect(remoteLabel({ isRemote: true, remoteScope: 'global' })).toBe('Удалённо · везде');
    expect(remoteLabel({ isRemote: true, remoteScope: 'US' })).toMatch(/^Удалённо · /u);
    expect(remoteLabel({ isRemote: true })).toBe('Удалённо');
  });

  it('локация: город без формата, удалёнка — подписью области', () => {
    expect(rowGeo(item({ canonicalLocation: 'Москва', workFormat: 'hybrid' }))).toBe('Москва');
    expect(rowGeo(item({ isRemote: true, workFormat: 'remote', remoteScope: 'global' }))).toBe(
      'Удалённо · везде',
    );
    expect(rowGeo(item({ workFormat: 'office' }))).toBe('Не указана');
  });

  it('формат словами, неизвестный — пусто', () => {
    expect(rowFormat(item({ workFormat: 'hybrid' }))).toBe('гибрид');
    expect(rowFormat(item({ workFormat: 'remote', isRemote: true }))).toBe('удалённо');
  });

  it('деньги в рублях — без «≈» и без подсказки', () => {
    const view = moneyView(item({ salary: { from: 480000, to: 580000, currency: 'RUR' } }), {
      currency: 'RUB',
      rates: RATES,
    });
    expect(view).toEqual({ amount: '480–580 тыс.', unit: '₽', text: '480–580 тыс. ₽' });
  });

  it('деньги в валюте пересчитаны по курсу ЦБ: «≈» и исходная сумма в подсказке', () => {
    const view = moneyView(item({ salary: { from: 6000, to: 7000, currency: 'USD' } }), {
      currency: 'RUB',
      rates: RATES,
    });
    expect(view.text).toBe('≈ 545–636 тыс. ₽');
    expect(view.title).toContain('В вакансии $6–7 тыс.');
    expect(view.title).toContain('курс ЦБ на 10.11');
  });

  it('нет курса или «Как в вакансии» — исходная сумма без «≈»', () => {
    const usd = item({ salary: { from: 6000, to: 7000, currency: 'USD' } });
    expect(moneyView(usd, { currency: 'RUB', rates: undefined }).text).toBe('$6–7 тыс.');
    expect(moneyView(usd, { currency: 'ORIG', rates: RATES }).text).toBe('$6–7 тыс.');
  });

  it('одна граница и пустая вилка', () => {
    expect(
      moneyView(item({ salary: { from: 700000, currency: 'RUR' } }), { currency: 'RUB' }).text,
    ).toBe('от 700 тыс. ₽');
    expect(moneyView(item({}), { currency: 'RUB' }).text).toBe('не указана');
  });

  it('слова', () => {
    expect(fitTierWord('hi')).toBe('сильное');
    expect(fitTierWord('low')).toBe('слабое');
    expect(vacanciesWord(1)).toBe('вакансия');
    expect(vacanciesWord(214)).toBe('вакансий');
    expect(vacanciesWord(122)).toBe('вакансии');
    expect(pluralRu(3, 'навык', 'навыка', 'навыков')).toBe('навыка');
  });

  it('внешний адрес — только http и https', () => {
    expect(safeHttpUrl('https://hh.ru/vacancy/1')).toBe('https://hh.ru/vacancy/1');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,x')).toBeUndefined();
    expect(safeHttpUrl('не адрес')).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });
});
