import { describe, expect, it } from 'vitest';
import { clusterCitiesByGrid, formatCityDisplay, fitMapView } from './vacancyMapCluster';
import type { CityFacet } from './vacancyFacets';

describe('B375: vacancy map clustering and normalization', () => {
  const amsterdam: CityFacet = {
    city: 'Amsterdam',
    country: 'Нидерланды',
    coordinates: { lat: 52.37, lng: 4.9 },
    count: 5,
    companyCount: 3,
  };

  const veldhoven: CityFacet = {
    city: 'Veldhoven',
    country: 'Нидерланды',
    coordinates: { lat: 51.42, lng: 5.41 },
    count: 2,
    companyCount: 1,
  };

  const moscow: CityFacet = {
    city: 'Москва',
    country: 'Россия',
    coordinates: { lat: 55.75, lng: 37.62 },
    count: 10,
    companyCount: 8,
  };

  // B446-g4: метки — капсулы шириной ~120 единиц на zoom=1; пересекающиеся сливаются.
  it('кластеризует точки, чьи капсулы пересеклись бы, с суммой вакансий', () => {
    const nodes = clusterCitiesByGrid([amsterdam, veldhoven, moscow], 1);
    const cluster = nodes.find((n) => n.isCluster);

    expect(cluster).toBeDefined();
    if (cluster && cluster.isCluster) {
      expect(cluster.totalCount).toBe(17); // 5 + 2 + 10
      expect(cluster.cities.map((c) => c.city).sort()).toEqual([
        'Amsterdam',
        'Veldhoven',
        'Москва',
      ]);
    }
  });

  it('при увеличении масштаба (zoom=3) Москва отделяется, соседние города НЛ остаются вместе', () => {
    const nodes = clusterCitiesByGrid([amsterdam, veldhoven, moscow], 3);
    expect(nodes.find((n) => !n.isCluster && n.city.city === 'Москва')).toBeDefined();
    const cluster = nodes.find((n) => n.isCluster);
    expect(cluster && cluster.isCluster && cluster.cities.map((c) => c.city).sort()).toEqual([
      'Amsterdam',
      'Veldhoven',
    ]);
  });

  it('не допускает наложения подписей городов', () => {
    const closeCity1: CityFacet = {
      city: 'CityOne',
      coordinates: { lat: 40.0, lng: 10.0 },
      count: 10,
      companyCount: 5,
    };
    const closeCity2: CityFacet = {
      city: 'CityTwoVeryLongName',
      coordinates: { lat: 40.1, lng: 10.2 },
      count: 2,
      companyCount: 1,
    };

    // При зуме, где они разделены как отдельные узлы, но их подписи пересекаются
    const nodes = clusterCitiesByGrid([closeCity1, closeCity2], 3);
    const visibleLabels = nodes.filter((n) => !n.isCluster && n.showLabel);
    expect(visibleLabels.length).toBeLessThanOrEqual(1);
  });

  it('нормализует префикс «AU: Sydney»: показывает «Сидней» и страну в подсказке', () => {
    const display = formatCityDisplay('AU: Sydney', undefined);
    expect(display.city).toBe('Сидней');
    expect(display.country).toBe('Австралия');
    expect(display.tooltip).toContain('Австралия');
    expect(display.city).not.toContain('AU:');
  });

  it('сохраняет подсказку страны для городов с известной страной', () => {
    const display = formatCityDisplay('Sydney', 'Australia');
    expect(display.city).toBe('Сидней');
    expect(display.country).toBe('Австралия');
    expect(display.tooltip).toBe('Австралия');
  });
});

describe('fitMapView (B446-g4)', () => {
  it('zooms to the bounds of the result points with a margin, capped at 3', () => {
    const view = fitMapView([
      { x: 600, y: 120 },
      { x: 640, y: 140 },
    ]);
    expect(view.zoom).toBe(3);
    expect(view.center).toEqual({ x: 620, y: 130 });
  });
  it('shows the whole world when points span it or there are none', () => {
    expect(fitMapView([])).toEqual({ zoom: 1, center: { x: 450, y: 240 } });
    expect(
      fitMapView([
        { x: 10, y: 10 },
        { x: 890, y: 470 },
      ]).zoom,
    ).toBe(1);
  });
});

describe('capsule collisions (B446-g4)', () => {
  const near = (city: string, lng: number, count: number): CityFacet => ({
    city,
    coordinates: { lat: 55.7, lng },
    count,
    companyCount: 1,
  });

  it('merges nodes whose capsules would overlap into one cluster, at any zoom', () => {
    const cities = [near('Москва', 37.6, 30), near('Тверь', 38.4, 2), near('Ижевск', 39.0, 3)];
    for (const zoom of [1, 2, 3]) {
      const nodes = clusterCitiesByGrid(cities, zoom);
      for (const a of nodes)
        for (const b of nodes)
          if (a !== b)
            expect(Math.abs(a.x - b.x) >= 120 / zoom || Math.abs(a.y - b.y) >= 28 / zoom).toBe(
              true,
            );
    }
  });
});
