import { describe, expect, it } from 'vitest';
import {
  buildMapMarkers,
  capsuleWidth,
  cityBounds,
  clampMarker,
  focusBounds,
  markerLabel,
  formatCityDisplay,
  type ScreenProjector,
} from './vacancyMapCluster';
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

  // B553: метки считаются в пикселях экрана карты; проектор подставляет MapLibre.
  const flat =
    (scale: number): ScreenProjector =>
    (point) => ({
      x: point.lng * scale,
      y: -point.lat * scale,
    });

  it('сливает капсулы, которые наехали бы друг на друга, в кластер с суммой', () => {
    const nodes = buildMapMarkers([amsterdam, veldhoven, moscow], flat(4));
    const cluster = nodes.find((node) => node.isCluster);
    expect(cluster?.isCluster && cluster.totalCount).toBe(7);
    expect(cluster?.isCluster && cluster.cities.map((city) => city.city)).toEqual([
      'Amsterdam',
      'Veldhoven',
    ]);
    expect(nodes.find((node) => !node.isCluster && node.city.city === 'Москва')).toBeDefined();
  });

  it('при приближении кластер распадается на города', () => {
    const nodes = buildMapMarkers([amsterdam, veldhoven, moscow], flat(400));
    expect(nodes.every((node) => !node.isCluster)).toBe(true);
    expect(nodes).toHaveLength(3);
  });

  it('выбранный город не прячется в кластер', () => {
    const nodes = buildMapMarkers([amsterdam, veldhoven], flat(4), 'Veldhoven');
    expect(nodes.filter((node) => !node.isCluster)).toHaveLength(2);
  });

  it('города без координат на карту не попадают', () => {
    const nowhere: CityFacet = { city: 'Нигде', count: 3, companyCount: 1 };
    expect(buildMapMarkers([nowhere], flat(4))).toEqual([]);
    expect(cityBounds([nowhere])).toBeUndefined();
  });

  it('границы охватывают все точки выдачи', () => {
    expect(cityBounds([amsterdam, moscow])).toEqual([
      [4.9, 52.37],
      [37.62, 55.75],
    ]);
  });

  it('карта открывается на ядре выдачи: 5 крупнейших близких городов, выбросы не тянут рамку', () => {
    const city = (name: string, lat: number, lng: number, count: number): CityFacet => ({
      city: name,
      coordinates: { lat, lng },
      count,
      companyCount: 1,
    });
    const spb = city('Санкт-Петербург', 59.94, 30.31, 18);
    const kazan = city('Казань', 55.79, 49.12, 6);
    const ekb = city('Екатеринбург', 56.84, 60.6, 9);
    const nsk = city('Новосибирск', 55.03, 82.92, 5);
    const london = city('London', 51.5, -0.12, 2);
    const vladivostok = city('Владивосток', 43.12, 131.9, 8);
    expect(focusBounds([moscow, spb, kazan, ekb, nsk, london, vladivostok])).toEqual([
      [30.31, 55.03],
      [82.92, 59.94],
    ]);
    expect(focusBounds([london])).toEqual(cityBounds([london]));
  });

  it('кластер называет крупнейший город и общее число, без «+N»', () => {
    const [cluster] = buildMapMarkers([amsterdam, veldhoven], flat(4));
    expect(cluster?.isCluster).toBe(true);
    expect(cluster && markerLabel(cluster)).toBe('Amsterdam');
  });

  it('капсулу у края сдвигает внутрь, точку за краем не показывает', () => {
    const view = { width: 400, height: 300 };
    expect(clampMarker({ x: 5, y: 150 }, 'Москва 74', view)).toEqual({
      x: capsuleWidth('Москва 74') / 2,
      y: 150,
    });
    expect(clampMarker({ x: 200, y: 299 }, 'Казань 6', view)).toEqual({ x: 200, y: 278 });
    expect(clampMarker({ x: -40, y: 150 }, 'Москва 74', view)).toBeUndefined();
  });

  it('ширина капсулы растёт с подписью и не меньше зоны касания 44 px', () => {
    expect(capsuleWidth('Москва 74')).toBeGreaterThan(capsuleWidth('Уфа 1'));
    expect(capsuleWidth('A')).toBeGreaterThanOrEqual(44);
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
