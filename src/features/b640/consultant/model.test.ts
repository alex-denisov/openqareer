import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../../coach/coachApi';
import type { TariffQuotaSummary } from '../../tariffs/tariffQuotaApi';
import {
  conversationTitle,
  dayLabel,
  dayMarks,
  factsByMessage,
  limitOf,
  panelTitle,
  pendingLabel,
  proposedFacts,
  refusalOf,
  stageOfNav,
} from './model';

function memory(over: Partial<CandidateMemory>): CandidateMemory {
  return {
    id: 'm1',
    kind: 'fact',
    domain: 'outcome',
    statement: 'Сфера Платежи — команда 18 человек',
    confidence: 'candidate-reported',
    sourceMessageIds: ['u2'],
    sensitive: false,
    status: 'proposed',
    ...over,
  };
}

function quotas(over: Partial<TariffQuotaSummary> = {}, remaining = 0): TariffQuotaSummary {
  return {
    plan: 'free',
    unlimited: false,
    period: { startedAt: '2026-10-20T00:00:00.000Z', endsAt: '2026-11-20T09:00:00.000Z' },
    quotas: [
      {
        key: 'coach_turns',
        label: 'Сообщения консультанту',
        limit: 30,
        used: 30 - remaining,
        remaining,
        upgradePlan: 'basic',
      },
    ],
    fitPercentLimit: null,
    ...over,
  };
}

describe('модель «Консультанта»', () => {
  it('заголовок панели называет раздел, без раздела — просто «Консультант»', () => {
    expect(panelTitle('vacancies')).toBe('Консультант · Вакансии');
    expect(panelTitle('today')).toBe('Консультант · Сегодня');
    expect(panelTitle(null)).toBe('Консультант');
  });

  it('раздел кабинета переводится в тему разговора', () => {
    expect(stageOfNav('vacancies')).toBe('vacancies');
    expect(stageOfNav('profile')).toBe('profile');
    expect(stageOfNav('diary')).toBe('diary');
    expect(stageOfNav('settings')).toBe('today');
    expect(stageOfNav(null)).toBe('today');
  });

  it('строка ожидающих записей склоняется', () => {
    expect(pendingLabel(1)).toBe('1 запись ждёт проверки');
    expect(pendingLabel(3)).toBe('3 записи ждут проверки');
    expect(pendingLabel(5)).toBe('5 записей ждут проверки');
    expect(pendingLabel(11)).toBe('11 записей ждут проверки');
    expect(pendingLabel(21)).toBe('21 запись ждёт проверки');
  });

  it('в ленту идут только предложенные факты без чувствительных', () => {
    const facts = proposedFacts([
      memory({ id: 'a' }),
      memory({ id: 'b', status: 'confirmed' }),
      memory({ id: 'c', kind: 'hypothesis' }),
      memory({ id: 'd', sensitive: true }),
    ]);
    expect(facts.map((fact) => fact.id)).toEqual(['a']);
  });

  it('карточка записи встаёт после ответа на сообщение-источник', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'Вопрос' },
      { id: 'a1', role: 'assistant' as const, content: 'Ответ' },
      { id: 'u2', role: 'user' as const, content: 'Команда была 18 человек' },
      { id: 'a2', role: 'assistant' as const, content: 'Принято' },
      { id: 'u3', role: 'user' as const, content: 'Без ответа' },
    ];
    const placed = factsByMessage(messages, [
      memory({ id: 'f1', sourceMessageIds: ['u2'] }),
      memory({ id: 'f2', sourceMessageIds: ['u3'] }),
      memory({ id: 'f3', sourceMessageIds: ['other-conversation'] }),
    ]);
    expect(placed.get('a2')?.map((fact) => fact.id)).toEqual(['f1']);
    expect(placed.get('u3')?.map((fact) => fact.id)).toEqual(['f2']);
    expect([...placed.values()].flat().map((fact) => fact.id)).not.toContain('f3');
  });

  it('предел: остаток 0 закрывает ввод, дата и тариф берутся из квот', () => {
    expect(limitOf(quotas(), null)).toEqual({ resetLabel: '20 ноября', upgradePlan: 'Basic' });
    expect(limitOf(quotas({}, 5), null)).toBeNull();
    expect(limitOf(quotas({ unlimited: true }), null)).toBeNull();
    expect(limitOf(null, null)).toBeNull();
  });

  it('предел после отказа сервера показывается и без данных квот', () => {
    expect(limitOf(null, refusalOf({}))).toEqual({ resetLabel: null, upgradePlan: null });
    expect(limitOf(null, refusalOf({ upgradePlan: 'pro' }))).toEqual({
      resetLabel: null,
      upgradePlan: 'Pro',
    });
    expect(limitOf(null, refusalOf({ upgradePlan: '<b>x</b>' }))?.upgradePlan).toBeNull();
    expect(limitOf(quotas({}, 5), refusalOf({}))).toEqual({
      resetLabel: '20 ноября',
      upgradePlan: 'Basic',
    });
  });

  it('у высшего тарифа пути к другому тарифу нет', () => {
    const max = quotas({ plan: 'max' });
    const top = { ...max, quotas: [{ ...max.quotas[0], upgradePlan: null }] };
    expect(limitOf(top, null)).toEqual({ resetLabel: '20 ноября', upgradePlan: null });
  });

  it('тема разговора — первый вопрос одной строкой, без разметки; итог целиком не выводится', () => {
    const summary = '**Что выяснили**\n- В шапке резюме есть три утверждения\n- Нет цифр';
    expect(conversationTitle({ summary, firstPhrase: '  С чего\nначать **поиск**  ' })).toBe(
      'С чего начать поиск',
    );
    expect(conversationTitle({ summary, firstPhrase: '' })).toBe('Что выяснили');
    expect(conversationTitle({ summary: '## Итог\n1. Первое', firstPhrase: ' ' })).toBe('Итог');
    expect(conversationTitle({ summary: null, firstPhrase: '2025. Итог по snake_case' })).toBe(
      '2025. Итог по snake_case',
    );
    expect(conversationTitle({ summary: ' ', firstPhrase: '' })).toBe('Разговор без темы');
    expect(conversationTitle({ summary: null, firstPhrase: '' })).toBe('Разговор без темы');
  });

  it('дата разговора: сегодня со временем, иначе день и месяц', () => {
    const now = new Date(2026, 10, 16, 20, 0);
    expect(dayLabel(new Date(2026, 10, 16, 15, 2).toISOString(), now)).toBe('Сегодня, 15:02');
    expect(dayLabel(new Date(2026, 10, 11, 9, 30).toISOString(), now)).toBe('11 ноября');
    expect(dayLabel('не дата', now)).toBeNull();
  });

  // B645-2: в k01 разговор начинается меткой дня «Сегодня, 15:02», как в макете.
  it('метка дня стоит у первого сообщения каждого дня разговора', () => {
    const now = new Date(2026, 10, 16, 20, 0);
    const at = (day: number, hour: number, minute: number) =>
      new Date(2026, 10, day, hour, minute).toISOString();
    const marks = dayMarks(
      [
        { id: 'a', role: 'user', content: 'q', at: at(11, 9, 30) },
        { id: 'b', role: 'assistant', content: 'r', at: at(11, 9, 31) },
        { id: 'c', role: 'user', content: 'q', at: at(15, 18, 5) },
        { id: 'd', role: 'user', content: 'q', at: at(16, 15, 2) },
        { id: 'e', role: 'assistant', content: 'r', at: at(16, 15, 3) },
        { id: 'f', role: 'user', content: 'q' },
      ],
      now,
    );
    expect([...marks]).toEqual([
      ['a', '11 ноября'],
      ['c', 'Вчера, 18:05'],
      ['d', 'Сегодня, 15:02'],
    ]);
  });
});
