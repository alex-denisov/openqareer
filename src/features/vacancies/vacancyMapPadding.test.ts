import { describe, expect, it } from 'vitest';
import { vacancyMapFitPadding } from './vacancyMapPadding';

// Замер на проде 23.10, 390: ± — 12…108 px от верха карты, карточка города — нижние 102 px,
// капсула 44 px (половина 22).
const ZOOM_CONTROLS_BOTTOM = 108;
const CITY_CARD_HEIGHT = 102;
const CAPSULE_HALF = 22;

describe('B553: подгонка карты не прячет капсулы под ± и карточку (390)', () => {
  it('сверху ниже ±, снизу выше карточки города', () => {
    const padding = vacancyMapFitPadding(390);
    expect(padding.top).toBeGreaterThanOrEqual(ZOOM_CONTROLS_BOTTOM + CAPSULE_HALF);
    expect(padding.bottom).toBeGreaterThanOrEqual(CITY_CARD_HEIGHT + CAPSULE_HALF);
  });

  it('1440 не меняется', () => {
    expect(vacancyMapFitPadding(1440)).toEqual({ top: 56, bottom: 96, left: 96, right: 112 });
  });
});
