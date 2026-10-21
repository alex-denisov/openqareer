import { describe, expect, it } from 'vitest';
import { buildVacancyMapStyle, MAP_TILE_HOST, OSM_ATTRIBUTION } from './vacancyMapStyle';

const palette = {
  land: 'rgb(20, 24, 30)',
  water: 'rgb(12, 14, 20)',
  line: 'rgb(60, 64, 72)',
  label: 'rgb(180, 186, 196)',
  halo: 'rgb(20, 24, 30)',
};

describe('B553: тёмный стиль карты вакансий', () => {
  it('берёт векторные тайлы OpenFreeMap и подписывает OSM', () => {
    const style = buildVacancyMapStyle(palette);
    const source = style.sources.openmaptiles;
    expect(source).toMatchObject({ type: 'vector', url: `${MAP_TILE_HOST}/planet` });
    expect(source && 'attribution' in source && source.attribution).toBe(OSM_ATTRIBUTION);
    expect(OSM_ATTRIBUTION).toContain('OpenStreetMap');
    expect(style.glyphs?.startsWith(MAP_TILE_HOST)).toBe(true);
  });

  it('красит карту цветами палитры токенов, без своих ярких цветов', () => {
    const style = buildVacancyMapStyle(palette);
    const colors = JSON.stringify(style.layers).match(/rgb\([^)]*\)/gu) ?? [];
    expect(new Set(colors)).toEqual(new Set(Object.values(palette)));
    const label = style.layers.find((layer) => layer.id === 'place-label');
    expect(label?.type).toBe('symbol');
  });
});
