import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MapCapsuleButton } from './VacancyMapControls';
import type { MapNode } from './vacancyMapCluster';

/** B553: нативный title в окне Tauri рисовался без фона и ложился на соседние капсулы. */
describe('подсказка капсулы на карте', () => {
  const cluster: MapNode = {
    id: 'c1',
    isCluster: true,
    x: 0,
    y: 0,
    totalCount: 25,
    cities: [
      { city: 'Москва', country: 'Россия', count: 20, companyCount: 9 },
      { city: 'Тула', country: 'Россия', count: 5, companyCount: 2 },
    ],
  };

  const markup = renderToStaticMarkup(
    <MapCapsuleButton node={cluster} x={0} y={0} count={25} active={false} onClick={() => {}} />,
  );

  it('не использует нативный title', () => {
    expect(markup).not.toMatch(/\stitle=/u);
  });

  it('показывает свою подсказку с составом кластера, скрытую от экранного чтеца', () => {
    expect(markup).toMatch(
      /<span class="career-map-tip" aria-hidden="true">Кластер: 25 вакансий \(Москва \(20\), Тула \(5\)\)/u,
    );
  });

  it('имя кнопки для экранного чтеца сохраняет состав кластера', () => {
    expect(markup).toContain('aria-label="Кластер: 25 вакансий (Москва (20), Тула (5))');
  });
});
