import { describe, expect, it } from 'vitest';
import {
  bridgeRole,
  formatFork,
  incomeShift,
  requirementsMeta,
  type ProfessionRequirement,
} from './professionPathModel';
import type { RoleRow } from './rolesModel';

const req = (name: string, inProfile: boolean): ProfessionRequirement => ({
  name,
  vacancies: 10,
  inProfile,
});

const row = (title: string, vacancies: number, requirements: string[]): RoleRow => ({
  id: title,
  title,
  label: title,
  wage: null,
  wageNote: 'нет данных о зарплатах',
  vacancies,
  origin: 'experience',
  confirms: null,
  lacks: null,
  check: null,
  requirements,
});

describe('professionPathModel', () => {
  it('counts requirements already in the profile', () => {
    expect(requirementsMeta([req('A', true), req('B', false), req('C', true)])).toBe(
      '2 из 3 требований',
    );
    expect(requirementsMeta([req('A', true)])).toBe('1 из 1 требования');
  });

  it('picks the bridge role closest to the target requirements, not the target itself', () => {
    const rows = [
      row('Продакт-менеджер', 90, ['Метрики', 'Исследования']),
      row('Руководитель разработки', 64, ['Команда']),
      row('Технический продакт-менеджер', 41, ['Метрики', 'Команда']),
    ];
    const target = [req('Метрики', false), req('Команда', true), req('Исследования', false)];
    expect(bridgeRole(rows, 'Продакт-менеджер', target)?.title).toBe(
      'Технический продакт-менеджер',
    );
    expect(bridgeRole([row('Дизайнер', 10, ['Figma'])], 'Продакт-менеджер', target)).toBeNull();
    expect(bridgeRole([row('Аналитик', 0, ['Метрики'])], 'Продакт-менеджер', target)).toBeNull();
  });

  it('B741: общие навыки управления не делают роль промежуточной', () => {
    const target = [
      req('Управление командой', true),
      req('Стратегическое планирование', true),
      req('P&L', true),
      req('OKR', false),
      req('KPI', false),
      req('Управление рисками', true),
      req('Метрики', false),
    ];
    const rows = [
      row('COO', 120, [
        'Управление командой',
        'Стратегическое планирование',
        'P&L',
        'OKR',
        'KPI',
        'Управление рисками',
      ]),
      row('Технический продакт-менеджер', 12, ['Метрики']),
    ];
    expect(bridgeRole(rows, 'Продакт-менеджер', target)?.title).toBe(
      'Технический продакт-менеджер',
    );
    expect(bridgeRole([rows[0]], 'Продакт-менеджер', target)).toBeNull();
    expect(
      bridgeRole(
        [row('Operations Director', 5, ['Team management', 'Risk management'])],
        'Продакт-менеджер',
        [req('Team management', true), req('Risk management', true)],
      ),
    ).toBeNull();
  });

  it('formats the fork in thousands', () => {
    expect(formatFork(350_000, 420_000)).toBe('350–420 тыс. ₽');
  });

  it('compares the fork with the current income', () => {
    expect(incomeShift(350_000, 420_000, 440_000)).toEqual({ kind: 'lower', from: 5, to: 20 });
    expect(incomeShift(450_000, 500_000, 400_000)).toEqual({ kind: 'higher', from: 13, to: 25 });
    expect(incomeShift(380_000, 480_000, 440_000)).toEqual({ kind: 'same' });
  });
});
