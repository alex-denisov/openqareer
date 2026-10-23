import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MapCapsuleButton } from './VacancyMapControls';
import type { MapNode } from './vacancyMapCluster';

/** B553: нативный title в окне Tauri рисовался без фона и ложился на соседние капсулы. */
describe('подсказка капсулы на карте', () => {
  const city = (name: string, count: number) => ({
    city: name,
    country: 'Россия',
    count,
    companyCount: 1,
  });
  const cluster: MapNode = {
    id: 'c1',
    isCluster: true,
    x: 0,
    y: 0,
    totalCount: 37,
    cities: [
      city('Тула', 5),
      city('Москва', 20),
      city('Тверь', 3),
      city('Рязань', 2),
      city('Химки', 2),
      city('Клин', 2),
      city('Псков', 2),
      city('Пенза', 1),
    ],
  };

  const markup = renderToStaticMarkup(
    <MapCapsuleButton node={cluster} x={0} y={0} count={37} active={false} onClick={() => {}} />,
  );

  it('не использует нативный title', () => {
    expect(markup).not.toMatch(/\stitle=/u);
  });

  it('подсказка скрыта от экранного чтеца, имя кнопки хранит полный состав', () => {
    expect(markup).toContain('class="career-map-tip" aria-hidden="true"');
    expect(markup).toContain('aria-label="Кластер: 37 вакансий (Тула (5), Москва (20)');
  });

  it('заголовок с числом, города по убыванию, не больше шести, остаток одной строкой', () => {
    const tip = markup.slice(markup.indexOf('career-map-tip'));
    expect(tip).toContain('37 вакансий в 8 городах');
    const rows = [...tip.matchAll(/career-map-tip-city">([^<]+)</gu)].map((m) => m[1]);
    expect(rows).toEqual(['Москва', 'Тула', 'Тверь', 'Рязань', 'Химки', 'Клин']);
    expect(tip).toContain('и ещё 2 города · 3');
    expect(tip).toContain('Нажмите, чтобы приблизить');
  });
});

it('после 21 — «в 21 городе»', () => {
  const many: MapNode = {
    id: 'c2',
    isCluster: true,
    x: 0,
    y: 0,
    totalCount: 21,
    cities: Array.from({ length: 21 }, (_, index) => ({
      city: `Город ${index}`,
      count: 1,
      companyCount: 1,
    })),
  };
  const html = renderToStaticMarkup(
    <MapCapsuleButton node={many} x={0} y={0} count={21} active={false} onClick={() => {}} />,
  );
  expect(html).toContain('21 вакансия в 21 городе');
});
