import { describe, expect, it } from 'vitest';
import {
  conditionsPath,
  isConditionsView,
  linkedDate,
  linkedRole,
  roleVacanciesPath,
} from './careerPaths';

describe('условия поиска по адресу', () => {
  it('адрес условий — вкладка «Роли» с параметром', () => {
    expect(conditionsPath()).toBe('/app/career?view=conditions');
    expect(isConditionsView('?view=conditions')).toBe(true);
    expect(isConditionsView('')).toBe(false);
    expect(isConditionsView('?view=other')).toBe(false);
  });
});

describe('B726: «Вакансии по роли» несут роль в «Подборку»', () => {
  it('адрес с ролью и чтение роли из адреса', () => {
    const path = roleVacanciesPath('Head of IT Service Management');
    expect(path).toBe('/app/vacancies?role=Head+of+IT+Service+Management&date=30');
    expect(linkedRole(path.slice(path.indexOf('?')))).toBe('Head of IT Service Management');
    expect(linkedRole('?role=%20%20')).toBeNull();
    expect(linkedRole('')).toBeNull();
  });
});

describe('B726: «Дата» из адреса — только значения фильтра', () => {
  it('30 дней по ссылке «Карьеры», чужое значение не ставится', () => {
    expect(linkedDate('?role=COO&date=30')).toBe('30');
    expect(linkedDate('?date=7')).toBe('7');
    expect(linkedDate('?date=45')).toBeNull();
    expect(linkedDate('?date=any')).toBeNull();
    expect(linkedDate('')).toBeNull();
  });
});
