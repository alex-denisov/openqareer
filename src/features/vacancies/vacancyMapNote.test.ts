import { describe, expect, it } from 'vitest';
import { vacancyMapNote } from './vacancyMapNote';

describe('заметка карты (B485)', () => {
  it('все без точки — удалённые: формулировка макета', () => {
    expect(
      vacancyMapNote({
        onMap: 112,
        shown: 148,
        total: 148,
        remoteOffMap: 36,
        missingCity: 0,
        unresolvedCity: 0,
      }),
    ).toBe(
      'На карте 112 из 148: у остальных 36 удалённая работа, без точки. Кластеры разбиваются при приближении.',
    );
  });

  it('смешанные причины перечисляются честно', () => {
    expect(
      vacancyMapNote({
        onMap: 10,
        shown: 20,
        total: 20,
        remoteOffMap: 4,
        missingCity: 4,
        unresolvedCity: 2,
      }),
    ).toBe(
      'На карте 10 из 20: без точки 4 с удалённой работой, 4 без города, 2 с нераспознанным городом. Кластеры разбиваются при приближении.',
    );
  });

  it('всё на карте', () => {
    expect(
      vacancyMapNote({
        onMap: 5,
        shown: 5,
        total: 5,
        remoteOffMap: 0,
        missingCity: 0,
        unresolvedCity: 0,
      }),
    ).toBe('На карте 5 из 5. Кластеры разбиваются при приближении.');
  });

  it('загружена часть выдачи — это сказано', () => {
    expect(
      vacancyMapNote({
        onMap: 40,
        shown: 50,
        total: 148,
        remoteOffMap: 10,
        missingCity: 0,
        unresolvedCity: 0,
      }),
    ).toBe(
      'На карте 40 из 50 загруженных: у остальных 10 удалённая работа, без точки. Ещё 98 вакансий из 148 догружаются. Кластеры разбиваются при приближении.',
    );
  });
});
