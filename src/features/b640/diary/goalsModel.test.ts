import { describe, expect, it } from 'vitest';
import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { cardInput, draftOf, emptyDraft, parseTarget, validate } from './goalForm';
import {
  formatValue,
  goalByline,
  goalsLead,
  indicatorView,
  indicatorsOf,
  longDate,
  plural,
  quarterLabel,
  riskTag,
  staleFlag,
} from './goalsModel';

const measurement = (value: number, measuredAt: string) => ({
  id: 'm',
  goalId: 'g',
  value,
  measuredAt,
  note: null,
  source: 'candidate_entered' as const,
  createdAt: '',
});

const summary = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Показатель ${id}`,
  type: 'operational',
  horizon: 'quarter',
  startDate: '2026-10-01',
  dueDate: '2027-01-29',
  unit: 'дней',
  baselineValue: 14,
  targetValue: 7,
  valueSource: 'candidate_entered',
  parentGoalId: null,
  isPrimary: false,
  createdAt: '',
  updatedAt: '',
  latestMeasurement: null,
  risk: { status: 'on_track', rule: 'linear_progress_v1', explanation: '' },
  ...extra,
});

const card = (extra: Record<string, unknown> = {}) =>
  ({
    ...summary('goal', { title: 'Выпускать релиз за неделю' }),
    details: { setBy: 'manager', agreedOn: '2026-12-12', weight: null, archive: null },
    indicators: [summary('i1', { latestMeasurement: measurement(5, '2026-11-03') })],
    ...extra,
  }) as unknown as CareerDiaryGoalCard;

describe('цели: подписи', () => {
  it('даты, квартал, склонения', () => {
    expect(longDate('2026-12-12', '2026-11-19')).toBe('12 декабря');
    expect(longDate('2027-12-31', '2026-11-19')).toBe('31 декабря 2027');
    expect(quarterLabel('2026-11-19')).toBe('IV квартал 2026');
    expect(plural(3, 'неделю', 'недели', 'недель')).toBe('недели');
    expect(plural(11, 'неделю', 'недели', 'недель')).toBe('недель');
    expect(plural(21, 'неделю', 'недели', 'недель')).toBe('неделю');
  });

  it('строка цели: кто, когда договорились, срок', () => {
    expect(goalByline(card(), '2026-11-19')).toBe(
      'руководитель · договорились 12 декабря · до 29 января 2027',
    );
  });

  it('показатель: замер «из 7 и меньше», без замера — «не внесено»', () => {
    expect(indicatorView(card().indicators[0]!)).toMatchObject({
      title: 'Показатель i1, дней',
      value: '5',
      target: 'из 7 и меньше',
      sub: '3 ноя · было 14',
    });
    expect(indicatorView(summary('x') as never)).toMatchObject({ value: 'не внесено', target: '' });
    expect(formatValue(82.5, '%')).toBe('82,5 %');
    expect(formatValue(false)).toBe('не сделано');
  });

  it('B683: единица из названия не повторяется в подписи показателя', () => {
    expect(
      indicatorView(summary('x', { title: 'Срок релиза, дней', unit: 'дней' }) as never).title,
    ).toBe('Срок релиза, дней');
    expect(indicatorView(summary('x', { title: 'Срок', unit: 'дней' }) as never).title).toBe(
      'Срок, дней',
    );
  });

  it('старая цель без разбиения — сама себе показатель', () => {
    const legacy = card({ indicators: [] });
    expect(indicatorsOf(legacy).map((goal) => goal.id)).toEqual(['goal']);
  });

  it('метки риска', () => {
    expect(riskTag('at_risk')).toEqual({ text: 'отстаёт', className: 'tag part' });
    expect(riskTag('unknown').text).toBe('нет замера');
  });

  it('пометка о старом замере — с двух недель', () => {
    expect(staleFlag(card(), '2026-11-10')).toBeNull();
    expect(staleFlag(card(), '2026-11-24')).toBe('Последний замер 3 недели назад');
  });

  it('заголовок вкладки', () => {
    const behind = card({
      id: 'b',
      title: 'Закрыть 2 вакансии',
      risk: { status: 'at_risk', rule: 'linear_progress_v1', explanation: '' },
    });
    expect(goalsLead([card(), behind])).toEqual({
      title: 'Отстаёт «Закрыть 2 вакансии»',
      focus: behind,
    });
    expect(goalsLead([card()]).title).toBe('Цели идут по плану');
    expect(goalsLead([behind, behind]).title).toBe('Отстают 2 цели');
  });
});

describe('форма цели', () => {
  it('проверка: название, срок, показатель с целью', () => {
    expect(validate(emptyDraft())).toEqual({
      title: 'Назовите цель',
      dueDate: 'Укажите срок',
      indicators: 'У показателя нужны название и цель',
    });
  });

  it('новая цель уходит одним запросом; пустые показатели отброшены', () => {
    const draft = {
      ...emptyDraft(),
      title: ' Сократить ревью ',
      dueDate: '2027-03-31',
      setBy: 'manager' as const,
      indicators: [
        { id: null, title: 'Время до ревью, часов', now: '18', target: '4' },
        { id: null, title: '', now: '', target: '' },
      ],
    };
    expect(validate(draft)).toEqual({});
    expect(cardInput(draft, '2026-11-19')).toEqual({
      title: 'Сократить ревью',
      horizon: 'quarter',
      startDate: '2026-11-19',
      dueDate: '2027-03-31',
      setBy: 'manager',
      indicators: [
        { title: 'Время до ревью, часов', unit: 'часов', baselineValue: 18, targetValue: 4 },
      ],
    });
  });

  it('цель показателя: число с запятой, «да», текст', () => {
    expect(parseTarget('82,5')).toBe(82.5);
    expect(parseTarget('да')).toBe(true);
    expect(parseTarget('выбран')).toBe('выбран');
  });

  it('правка: форма из цели', () => {
    expect(draftOf(card())).toMatchObject({
      title: 'Выпускать релиз за неделю',
      setBy: 'manager',
      indicators: [{ id: 'i1', title: 'Показатель i1', now: '14', target: '7' }],
    });
  });
});
