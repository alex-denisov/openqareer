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

  it('B764: место — только слово об удалёнке, формат «в офисе» — без английского «Remote»', () => {
    const remote = (canonicalLocation: string) =>
      rowGeo(item({ canonicalLocation, isRemote: true, workFormat: 'office' }));
    expect(remote('Remote')).toBe('Удалённо');
    expect(remote('Remote job')).toBe('Удалённо');
    expect(remote('Berlin, Remote')).toBe('Удалённо · Berlin');
    expect(rowGeo(item({ canonicalLocation: 'Remote', workFormat: 'office' }))).toBe('Удалённо');
  });

  it('формат словами, неизвестный — пусто', () => {
    expect(rowFormat(item({ workFormat: 'hybrid' }))).toBe('гибрид');
    expect(rowFormat(item({ workFormat: 'remote', isRemote: true }))).toBe('удалённо');
  });

  it('B765: сумма без периода 100–999 — как в вакансии, без ₽ и без периода (per diem 450–600 USD)', () => {
    const view = moneyView(item({ salary: { from: 450, to: 600, currency: 'USD' } }), {
      currency: 'RUB',
      rates: RATES,
    });
    expect(view.text).toBe('$450–600');
    expect(view.title).toBeUndefined();
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

  it('B593: дирхамы по курсу ЦБ — «≈», исходная сумма и курс дирхама в подсказке', () => {
    const rates = { date: '2026-11-10', rubPerUnit: { USD: 91, EUR: 99, AED: 24.8 } };
    const view = moneyView(item({ salary: { from: 6000, to: 7000, currency: 'USD' } }), {
      currency: 'AED',
      rates,
    });
    expect(view.text).toBe('≈ 22–26 тыс. AED');
    expect(view.title).toContain('В вакансии $6–7 тыс.');
    expect(view.title).toContain('1 AED = 24,8 ₽');
  });

  it('B765: годовая зарплата (Egen, прод 23.11) — в месяц, как вся колонка; в подсказке — «в год»', () => {
    const egen = item({ salary: { from: 218000, to: 265000, currency: 'USD', period: 'year' } });
    const view = moneyView(egen, { currency: 'RUB', rates: RATES });
    expect(view.text).toMatch(/^≈ 1\s650–2\s005 тыс\. ₽$/u);
    expect(view.title).toContain('В вакансии $218–265 тыс. в год');
    expect(moneyView(egen, { currency: 'ORIG', rates: RATES }).text).toBe('$218–265 тыс. в год');
  });

  it('B765: почасовая ставка (Arootah, прод 23.11) — ставка в рублях «в час», без месячной суммы', () => {
    const hourly = item({ salary: { from: 250, to: 400, currency: 'USD', period: 'hour' } });
    const view = moneyView(hourly, { currency: 'RUB', rates: RATES });
    expect(view.text).toBe('≈ 23–36 тыс. ₽ в час');
    expect(view.title).toContain('В вакансии $250–400 в час');
    expect(moneyView(hourly, { currency: 'ORIG', rates: RATES }).text).toBe('$250–400 в час');
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
