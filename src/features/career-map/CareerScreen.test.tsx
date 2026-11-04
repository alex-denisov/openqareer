import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerScreen } from './CareerScreen';
import {
  ConditionsMarketLine,
  MarketSourceStamp,
  RelocationRow,
} from './CareerConditionsComponents';
import { DEFAULT_MOCK_ROLES, DEFAULT_SEARCH_CONDITIONS } from './careerMockData';
import { EMPTY_SEARCH_CONDITIONS } from './careerConditionsStorage';

const full = { initialRoles: DEFAULT_MOCK_ROLES, initialConditions: DEFAULT_SEARCH_CONDITIONS };

describe('CareerScreen (B445)', () => {
  it('строки ролей: статус, вилка, число вакансий и дата из данных', () => {
    const html = renderToStaticMarkup(<CareerScreen {...full} />);
    expect(html).toContain('600–780 тыс. ₽ · 88 вакансий · 05.10');
    expect(html).toContain(
      '420–560 тыс. ₽ · 312 вакансий · вилка по 94 вакансиям с зарплатой, 05.10',
    );
    expect(html).toContain('вилка не считается · 4 вакансии');
    expect(html).toContain('Навыки проверены');
    // CPO 26.10: подборка уже идёт по всем ролям — ступени «Открыта для поиска» нет.
    expect(html).not.toContain('Открыта для поиска');
    expect(html).not.toContain('Открыть для поиска');
    expect(html).toContain('Гипотеза');
  });

  it('секции карточками: «Условия и география», «Мои роли на рынке», пояснения и плашка', () => {
    const html = renderToStaticMarkup(<CareerScreen {...full} />);
    expect(html).toContain('Условия и география');
    expect(html).toContain('Мои роли на рынке');
    expect(html).toContain('aria-label="Пояснение"');
    expect(html).toContain('«Вакансии» подбираются по всем ролям этого списка, включая гипотезы');
    expect(html).toContain('aria-label="Изменить: География"');
    expect(html).toContain('Москва, удалённо из РФ');
    expect(html).toContain('2 компании');
  });

  it('под ролями строка источника: площадки, число и дата из данных (макет 3)', () => {
    const html = renderToStaticMarkup(<CareerScreen {...full} />);
    expect(html.indexOf('Источник: каталог openqareer')).toBeGreaterThan(
      html.indexOf('Мои роли на рынке'),
    );
    const summary = {
      vacancyTotal: 87,
      asOf: '04.11',
      sources: ['hh.ru (страница поиска)', 'Indeed', 'LinkedIn'],
      conditionsCount: { withinConditions: 1067, byRoles: 1804, asOf: '04.11 04:14' },
    };
    expect(renderToStaticMarkup(<MarketSourceStamp summary={summary} />)).toContain(
      'Источник: каталог openqareer, hh.ru и LinkedIn · 1\u00a0804 вакансии · 04.11',
    );
    expect(renderToStaticMarkup(<MarketSourceStamp summary={summary} isMobile />)).toContain(
      'Источник: каталог openqareer, hh.ru и LinkedIn, 1\u00a0804 вакансии, 04.11.',
    );
  });

  it('строка источника не называет площадку, которой нет в данных, и молчит без вакансий', () => {
    const summary = { vacancyTotal: 12, asOf: null, sources: ['hh.ru'] };
    expect(renderToStaticMarkup(<MarketSourceStamp summary={summary} />)).toContain(
      'Источник: каталог openqareer и hh.ru · 12 вакансий',
    );
    expect(
      renderToStaticMarkup(
        <MarketSourceStamp summary={{ vacancyTotal: 0, asOf: null, sources: [] }} />,
      ),
    ).toBe('');
  });

  it('строка условий: N из M по ролям, а без подсчёта — честная прежняя фраза', () => {
    const counted = {
      vacancyTotal: 87,
      asOf: '04.11',
      sources: [],
      conditionsCount: { withinConditions: 1067, byRoles: 1804, asOf: '04.11 04:14' },
    };
    expect(renderToStaticMarkup(<ConditionsMarketLine summary={counted} />)).toContain(
      'С этими условиями: 1\u00a0067 вакансий из 1\u00a0804 по ролям, 04.11 04:14.',
    );
    expect(renderToStaticMarkup(<ConditionsMarketLine summary={counted} isMobile />)).toContain(
      'С этими условиями 1\u00a0067 вакансий из 1\u00a0804 по ролям, 04.11 04:14. Подборка пересчитывается при любой правке.',
    );
    const uncounted = { vacancyTotal: 87, asOf: '04.11', sources: [] };
    expect(renderToStaticMarkup(<ConditionsMarketLine summary={uncounted} />)).toContain(
      'Сколько из них проходит эти условия, ещё не посчитано.',
    );
    const nothing = {
      ...counted,
      conditionsCount: { withinConditions: 0, byRoles: 0, asOf: null },
    };
    expect(renderToStaticMarkup(<ConditionsMarketLine summary={nothing} />)).not.toContain(
      'из 0 по ролям',
    );
  });

  it('раскрытая роль с проверенными навыками — блоки и кнопки по статусу', () => {
    const html = renderToStaticMarkup(<CareerScreen {...full} />);
    expect(html).toContain('Подтверждено');
    expect(html).toContain('Чего не хватает для этой роли');
    expect(html).toContain('Профиль, Навыки');
    expect(html).toContain('Сверка с требованиями 88 вакансий, 05.10.');
    expect(html).toContain('Дозаполнить с консультантом');
    expect(html).toContain('Открыть вакансии роли');
    expect(html).toContain('Отклонить роль');
  });

  it('26.10: подборка идёт по ролям сразу, без условия проверки навыков', () => {
    const hypothesesOnly = DEFAULT_MOCK_ROLES.map((role) => ({
      ...role,
      status: 'hypothesis' as const,
    }));
    const early = renderToStaticMarkup(
      <CareerScreen initialRoles={hypothesesOnly} initialConditions={DEFAULT_SEARCH_CONDITIONS} />,
    );
    expect(early).toContain('Отклонённая роль уходит из подборки');
    expect(early).not.toContain('после проверки навыков');
  });

  it('релокация — строка-раскрытие без включения одним нажатием', () => {
    const html = renderToStaticMarkup(<CareerScreen {...full} />);
    expect(html).toContain('Страны и релокация');
    expect(html).toContain('Не включено');
    expect(html).not.toContain('Включить релокацию');
  });

  it('релокация — пока согласие не прочитано, статус не показан (не «Не включено»)', () => {
    const html = renderToStaticMarkup(
      <RelocationRow isRelocationEnabled={null} onOpenRelocation={() => {}} />,
    );
    expect(html).toContain('Страны и релокация');
    expect(html).not.toContain('Включено');
    expect(html).toContain('Проверяем, включён ли раздел');
  });

  it('без данных не выводит ни одного числа макета', () => {
    const html = renderToStaticMarkup(
      <CareerScreen initialRoles={[]} initialConditions={EMPTY_SEARCH_CONDITIONS} />,
    ).replace(/<svg[\s\S]*?<\/svg>/g, '');
    for (const fake of [
      '148',
      '214',
      '07.10 09:12',
      '312 вакансий',
      '450–650',
      '450 000',
      '05.10',
      'Москва',
    ]) {
      expect(html).not.toContain(fake);
    }
    expect(html).toContain('не указано');
    expect(html).toContain('Число вакансий с этими условиями ещё не посчитано.');
  });

  it('загрузка, пустой профиль, ошибка', () => {
    expect(renderToStaticMarkup(<CareerScreen isLoading />)).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(<CareerScreen {...full} hasProfile={false} />)).toContain(
      'Открыть профиль',
    );
    expect(renderToStaticMarkup(<CareerScreen {...full} marketError="x" />)).toContain('Повторить');
  });

  it('390: сначала роли списком со строкой-действием, затем условия поиска', () => {
    const html = renderToStaticMarkup(<CareerScreen {...full} isMobile />);
    expect(html.indexOf('Мои роли на рынке · 4')).toBeLessThan(html.indexOf('Условия поиска'));
    for (const action of ['Дозаполнить', 'Открыть вакансии', 'Проверить навыки', 'Мало данных']) {
      expect(html).toContain(action);
    }
    expect(html).toContain('сейчас подборка идёт только по России');
    expect(html.indexOf('Источник: каталог openqareer')).toBeGreaterThan(
      html.indexOf('Страны и релокация'),
    );
  });

  it('390: география короче, чем на 1440, как в макете', () => {
    const html = renderToStaticMarkup(<CareerScreen {...full} isMobile />);
    expect(html).toContain('Москва, РФ');
    expect(html).not.toContain('Москва, удалённо из РФ');
  });

  it('390: push-экран гипотезы с проверкой навыков', () => {
    const html = renderToStaticMarkup(
      <CareerScreen {...full} isMobile initialPushView="role:role-cto-финтехе" />,
    );
    expect(html).toContain('data-mv="role:role-cto-финтехе"');
    expect(html).toContain('Пока неизвестно');
    expect(html).toContain('Что даст проверка навыков');
    expect(html).toContain('Проверить навыки');
    expect(html).toContain('Обсудить с консультантом');
    expect(html).toContain('Назад');
  });

  it('390: push-экран зарплаты', () => {
    const html = renderToStaticMarkup(<CareerScreen {...full} isMobile initialPushView="sal" />);
    expect(html).toContain('data-mv="sal"');
    expect(html).toContain('Зарплата от');
  });
});
