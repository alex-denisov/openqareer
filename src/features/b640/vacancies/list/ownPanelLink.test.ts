import { describe, expect, it } from 'vitest';
import { buildNodePath } from '../../routes';
import { ownPanelPath, ownPanelRequested } from './ownPanelLink';

describe('B645: ссылка на панель «Своя вакансия»', () => {
  it('ведёт в подборку с открытой панелью', () => {
    expect(ownPanelPath()).toBe(`${buildNodePath('s07')}?own=1`);
    expect(ownPanelRequested('?own=1')).toBe(true);
  });

  it('без параметра панель закрыта', () => {
    expect(ownPanelRequested('')).toBe(false);
    expect(ownPanelRequested('?own=0')).toBe(false);
    expect(ownPanelRequested('?view=x')).toBe(false);
  });
});
