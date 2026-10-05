import { describe, expect, it } from 'vitest';
import { clusterCitiesByGrid, formatCityDisplay } from './vacancyMapCluster';
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

  it('кластеризует близкие точки при zoom=1 в один кластер с суммой вакансий', () => {
    const nodes = clusterCitiesByGrid([amsterdam, veldhoven, moscow], 1);
    const cluster = nodes.find((n) => n.isCluster);

    expect(cluster).toBeDefined();
    if (cluster && cluster.isCluster) {
      expect(cluster.totalCount).toBe(7); // 5 + 2
      expect(cluster.cities.map((c) => c.city)).toEqual(['Amsterdam', 'Veldhoven']);
    }

    const moscowNode = nodes.find((n) => !n.isCluster && n.city.city === 'Москва');
    expect(moscowNode).toBeDefined();
  });

  it('при увеличении масштаба (zoom=3) распадается на отдельные города', () => {
    const nodes = clusterCitiesByGrid([amsterdam, veldhoven, moscow], 3);
    const clusters = nodes.filter((n) => n.isCluster);
    expect(clusters).toHaveLength(0);

    const amsNode = nodes.find((n) => !n.isCluster && n.city.city === 'Amsterdam');
    const veldNode = nodes.find((n) => !n.isCluster && n.city.city === 'Veldhoven');
    expect(amsNode).toBeDefined();
    expect(veldNode).toBeDefined();
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
