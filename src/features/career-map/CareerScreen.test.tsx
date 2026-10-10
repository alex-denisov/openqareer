import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerScreen } from './CareerScreen';

describe('CareerScreen Component (B445 Criterion 1, 4)', () => {
  it('renders roles with honest wage calculation and status badges', () => {
    const html = renderToStaticMarkup(<CareerScreen />);
    expect(html).toContain('Карьера');
    expect(html).toContain('Director of Engineering');
    expect(html).toContain('600–780 тыс. ₽ · 88 вакансий · 05.10');

    // VP Engineering has 4 vacancies -> wage not calculated
    expect(html).toContain('VP Engineering');
    expect(html).toContain('вилка не считается · 4 вакансий · 05.10');

    // Status badges
    expect(html).toContain('Навыки проверены');
    expect(html).toContain('Открыта для поиска');
    expect(html).toContain('Гипотеза');
  });

  it('renders role action buttons to open vacancies and consultant', () => {
    const html = renderToStaticMarkup(<CareerScreen />);
    expect(html).toContain('Дозаполнить с консультантом');
    expect(html).toContain('Открыть вакансии роли');
    expect(html).toContain('Отклонить роль');
  });

  it('renders search conditions with geography, salary, format, stop-list', () => {
    const html = renderToStaticMarkup(<CareerScreen />);
    expect(html).toContain('Условия поиска');
    expect(html).toContain('Москва, Удалённо из РФ');
    expect(html).toContain('450 000 ₽');
    expect(html).toContain('Гибрид, удалённо');
    expect(html).toContain('2 компании');
    expect(html).toContain('148 вакансий из 214 по ролям');
  });

  it('renders relocation block with unincluded status and enable action', () => {
    const html = renderToStaticMarkup(<CareerScreen />);
    expect(html).toContain('Страны и релокация');
    expect(html).toContain('Не включено');
    expect(html).toContain('Включить релокацию');
  });

  it('renders loading skeleton when isLoading is true', () => {
    const html = renderToStaticMarkup(<CareerScreen isLoading={true} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Загрузка экрана карьеры');
  });

  it('renders empty profile state when hasProfile is false', () => {
    const html = renderToStaticMarkup(<CareerScreen hasProfile={false} />);
    expect(html).toContain('Гипотез нет: профиль пуст');
    expect(html).toContain('Открыть профиль');
    expect(html).toContain('Обсудить цель');
  });

  it('renders market error banner when marketError is provided', () => {
    const html = renderToStaticMarkup(<CareerScreen marketError="Catalog failed" />);
    expect(html).toContain('Позиция на рынке не загрузилась');
    expect(html).toContain('Повторить');
  });

  it('renders stale market note when isMarketStale is true', () => {
    const html = renderToStaticMarkup(<CareerScreen isMarketStale={true} />);
    expect(html).toContain('прошло больше 14 дней');
  });

  it('renders mobile 390 push view for role detail', () => {
    const html = renderToStaticMarkup(<CareerScreen isMobile={true} initialPushView="dir" />);
    expect(html).toContain('data-mv="dir"');
    expect(html).toContain('Director of Engineering');
    expect(html).toContain('Назад');
  });

  it('renders mobile 390 push view for salary edit', () => {
    const html = renderToStaticMarkup(<CareerScreen isMobile={true} initialPushView="sal" />);
    expect(html).toContain('data-mv="sal"');
    expect(html).toContain('Зарплата от');
    expect(html).toContain('Сохранить');
  });
});
