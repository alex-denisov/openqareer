import { describe, expect, it } from 'vitest';
import {
  campaignRoleLine,
  describeStrategy,
  strategyChangeNeedsReason,
} from './careerStrategyView';
import type { CareerStrategy, StrategyVersion } from '../../../shared/careerStrategy';

function version(overrides: Partial<StrategyVersion> = {}): StrategyVersion {
  return {
    version: 1,
    role: {
      title: 'Head of Product',
      origin: 'model',
      reason: 'вёл продукты девять лет',
      evidenceRefs: ['memory:1'],
      confirmation: { state: 'not-found', sampleSize: 0 },
    },
    constraints: { regions: ['eu'], note: null },
    reason: 'Первый выбор роли',
    decidedAt: '2026-09-03T16:00:00.000Z',
    provenance: { namedBy: 'gemini:gemini-3.6-flash', language: 'en', poolSize: 534 },
    ...overrides,
  };
}

describe('describeStrategy', () => {
  it('называет версию, дату и того, кто назвал роль', () => {
    const view = describeStrategy({ current: version(), history: [] });

    expect(view.title).toBe('Head of Product');
    expect(view.versionLine).toBe('версия 1 от 3 сентября');
    expect(view.originLine).toContain('модель');
    expect(view.originLine).toContain('вёл продукты девять лет');
    // Первая версия причину смены не печатает: менять было нечего.
    expect(view.reasonLine).toBeNull();
  });

  it('подтверждение читается как снимок момента выбора, а не как «сейчас»', () => {
    const view = describeStrategy({
      current: version({
        role: {
          title: 'Head of Product',
          origin: 'model',
          reason: null,
          evidenceRefs: [],
          confirmation: {
            state: 'observed',
            sampleSize: 12,
            observedFrom: '2026-08-20T00:00:00.000Z',
            observedTo: '2026-09-02T00:00:00.000Z',
          },
        },
      }),
      history: [],
    });

    expect(view.confirmationLine).toBe(
      'На 3 сентября 12 вакансий · наблюдение 20 августа — 2 сентября.',
    );
  });

  it('нулевое подтверждение называет и пул, на котором его не нашли', () => {
    const view = describeStrategy({ current: version(), history: [] });
    expect(view.confirmationLine).toBe(
      'На 3 сентября вакансий по этой роли в собранном пуле не было (пул: 534).',
    );
  });

  it('пустые рынки не выдаются за «ищу везде»', () => {
    const view = describeStrategy({
      current: version({ constraints: { regions: [], note: null } }),
      history: [],
    });
    expect(view.constraintsLine).toBe('рынки не названы — кампания их не сузит');
  });

  it('история печатает каждую прежнюю версию с её причиной', () => {
    const view = describeStrategy({
      current: version({ version: 2, reason: 'откликов много, разговоров нет' }),
      history: [
        version({
          version: 1,
          role: {
            title: 'Product Manager',
            origin: 'model',
            reason: null,
            evidenceRefs: [],
            confirmation: { state: 'not-found', sampleSize: 0 },
          },
          decidedAt: '2026-09-01T10:00:00.000Z',
        }),
      ],
    });

    expect(view.reasonLine).toBe('Причина смены: откликов много, разговоров нет');
    expect(view.history).toEqual([
      'версия 1 · Product Manager · 1 сентября · Первый выбор роли',
    ]);
  });

  it('роль, названную кандидатом, не приписывает модели', () => {
    const view = describeStrategy({
      current: version({
        role: {
          title: 'Директор по развитию',
          origin: 'candidate',
          reason: null,
          evidenceRefs: [],
          confirmation: { state: 'not-found', sampleSize: 0 },
        },
      }),
      history: [],
    });
    expect(view.originLine).toBe('Роль назвали вы сами.');
  });
});

describe('strategyChangeNeedsReason', () => {
  const strategy: CareerStrategy = { current: version(), history: [] };

  it('первый выбор причины не требует', () => {
    expect(strategyChangeNeedsReason(null, 'Head of Product')).toBe(false);
  });

  it('та же роль — не смена', () => {
    expect(strategyChangeNeedsReason(strategy, '  head of product ')).toBe(false);
  });

  it('другая роль требует причины', () => {
    expect(strategyChangeNeedsReason(strategy, 'Директор по развитию')).toBe(true);
  });
});

describe('campaignRoleLine', () => {
  it('кампания идёт по роли из стратегии, а не по свободной строке мастера', () => {
    expect(
      campaignRoleLine({ current: version(), history: [] }, 'хочу в продукт'),
    ).toBe('Роль «Head of Product» · версия 1 от 3 сентября');
  });

  it('без стратегии остаётся направление мастера — оно честно названо словами', () => {
    expect(campaignRoleLine(null, 'хочу в продукт')).toBe('Направление «хочу в продукт»');
  });

  it('без стратегии и без направления не выдумывает ни то, ни другое', () => {
    expect(campaignRoleLine(null, '  ')).toBe(
      'Роль не выбрана — подбор идёт по подтверждённым фактам',
    );
  });
});
