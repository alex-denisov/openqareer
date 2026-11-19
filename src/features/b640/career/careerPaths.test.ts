import { describe, expect, it } from 'vitest';
import { conditionsPath, isConditionsView } from './careerPaths';

describe('условия поиска по адресу', () => {
  it('адрес условий — вкладка «Роли» с параметром', () => {
    expect(conditionsPath()).toBe('/app/career?view=conditions');
    expect(isConditionsView('?view=conditions')).toBe(true);
    expect(isConditionsView('')).toBe(false);
    expect(isConditionsView('?view=other')).toBe(false);
  });
});
