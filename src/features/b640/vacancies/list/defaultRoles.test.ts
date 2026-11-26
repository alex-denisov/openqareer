import { describe, expect, it } from 'vitest';
import { defaultRoles } from './defaultRoles';

describe('роли по умолчанию', () => {
  it('сохранённый выбор сервера главнее выбора в «Карьере»', () => {
    expect(defaultRoles(['Аналитик'], { value: ['Руководитель разработки'], origin: 'explicit' })).toEqual(['Аналитик']);
  });

  it('без сохранённого выбора — роли поиска из «Карьеры»', () => {
    expect(defaultRoles([], { value: ['Руководитель разработки'], origin: 'explicit' })).toEqual(['Руководитель разработки']);
    expect(defaultRoles(undefined, { value: ['Продакт'], origin: 'profile' })).toEqual(['Продакт']);
  });

  it('роли «по умолчанию» выбором не считаются: «Все роли»', () => {
    expect(defaultRoles(undefined, { value: ['Любая'], origin: 'default' })).toEqual([]);
    expect(defaultRoles(undefined, undefined)).toEqual([]);
  });
});
