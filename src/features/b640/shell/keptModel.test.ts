import { describe, expect, it } from 'vitest';
import { matchNode } from '../routes';
import { keepKeyOf } from './journey';
import { MAX_KEPT, NO_KEPT, nextKept, type KeptScreens } from './keptModel';

function go(kept: KeptScreens, path: string, returning = false, search = ''): KeptScreens {
  return nextKept(kept, { keepKey: keepKeyOf(path), path, search, match: matchNode(path), returning });
}

const idOf = (kept: KeptScreens) =>
  kept.entries.find((entry) => entry.keepKey === kept.active)?.id ?? null;

describe('списки под объектом (B798)', () => {
  it('возврат открывает тот же список, переход из раздела — новый', () => {
    const list = go(NO_KEPT, '/app/vacancies');
    const card = go(list, '/app/vacancies/v1');
    expect(idOf(card)).toBeNull();
    expect(idOf(go(card, '/app/vacancies', true))).toBe(idOf(list));
    expect(idOf(go(card, '/app/vacancies'))).not.toBe(idOf(list));
    expect(idOf(go(card, '/app/vacancies', true, '?own=1'))).not.toBe(idOf(list));
  });

  it('раскрытие отклика не открывает список заново', () => {
    const list = go(NO_KEPT, '/app/responses');
    expect(idOf(go(list, '/app/responses/r1'))).toBe(idOf(list));
  });

  it('тот же адрес — то же состояние; давний список закрывается', () => {
    const list = go(NO_KEPT, '/app/vacancies');
    expect(go(list, '/app/vacancies')).toBe(list);
    const paths = ['/app/vacancies/saved', '/app/vacancies/companies', '/app/responses', '/app/diary'];
    const many = paths.reduce((kept, path) => go(kept, path), list);
    expect(many.entries).toHaveLength(MAX_KEPT);
    expect(many.entries.some((entry) => entry.keepKey === 's07')).toBe(false);
  });
});
