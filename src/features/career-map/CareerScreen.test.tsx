import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerScreen } from './CareerScreen';
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
    expect(html).toContain('Открыта для поиска');
    expect(html).toContain('Гипотеза');
  });

  it('секции карточками: «Условия и география», «Мои роли на рынке», пояснения и плашка', () => {
    const html = renderToStaticMarkup(<CareerScreen {...full} />);
    expect(html).toContain('Условия и география');
    expect(html).toContain('Мои роли на рынке');
    expect(html).toContain('aria-label="Пояснение"');
    expect(html).toContain('Поиск по ролям открывается после проверки навыков');
    expect(html).toContain('aria-label="Изменить: География"');
    expect(html).toContain('Москва, удалённо из РФ');
    expect(html).toContain('2 компании');
    expect(html).toContain('Источник: каталог openqareer, hh.ru и LinkedIn · 445 вакансий · 05.10');
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

  it('релокация — строка-раскрытие без включения одним нажатием', () => {
    const html = renderToStaticMarkup(<CareerScreen {...full} />);
    expect(html).toContain('Страны и релокация');
    expect(html).toContain('Не включено');
    expect(html).not.toContain('Включить релокацию');
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
