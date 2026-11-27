// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const detail = vi.hoisted(() => ({ state: {} as unknown }));
const fit = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../vacancies/vacancyDetailApi', () => ({ useVacancyDetail: () => detail.state }));
vi.mock('../../../vacancies/vacancyFitApi', () => ({ readVacancyFit: fit.read }));
const { bindSectionCacheOwner, clearSectionCache } = await import('../../../shell/sectionCache');
const { BriefBlock } = await import('./BriefBlock');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  root = createRoot(host);
  fit.read.mockRejectedValue(new Error('no fit'));
});
afterEach(() => {
  act(() => root.unmount());
  clearSectionCache();
});

const show = (state: unknown) => {
  detail.state = state;
  return act(async () => root.render(<BriefBlock clusterId="c" />));
};
const ready = (extra: object) => ({ status: 'ready', detail: { description: '', ...extra } });

describe('BriefBlock (B791)', () => {
  it('пока читается — скелет, и пока сервер дочитывает hh тоже', async () => {
    await show({ status: 'loading' });
    expect(host.querySelector('.is-skel')).not.toBeNull();
    await show(ready({ pending: true }));
    expect(host.querySelector('.is-skel')).not.toBeNull();
  });

  it('не прочитан, скрыт или пуст — блока нет', async () => {
    for (const state of [{ status: 'failed' }, ready({ textHidden: true }), ready({})]) {
      await show(state);
      expect(host.innerHTML).toBe('');
    }
  });

  it('разделы текста и абзац без разделов', async () => {
    await show(
      ready({ brief: { duties: ['Вести команду'], requirements: ['Go'], opening: 'О.' } }),
    );
    expect(host.textContent).toBe('ЗадачиВести командуТребованияGo');
    await show(ready({ brief: { duties: [], requirements: [], opening: 'О команде.' } }));
    expect(host.textContent).toBe('О команде.');
  });

  it('повторное раскрытие берёт прочитанное; дубли строк не теряются', async () => {
    bindSectionCacheOwner('me');
    fit.read.mockReset();
    fit.read.mockResolvedValue({ state: 'no_requirements', requirements: [] });
    await show(ready({ brief: { duties: ['a', 'a'], requirements: [], opening: 'О.' } }));
    expect(host.querySelectorAll('li')).toHaveLength(2);
    act(() => root.unmount());
    root = createRoot(host);
    await show({ status: 'loading' });
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(fit.read).toHaveBeenCalledTimes(1);
  });
});
