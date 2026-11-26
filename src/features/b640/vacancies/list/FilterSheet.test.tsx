// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenActive } from '../../kit/screenActive';
import { FilterSheet, type FilterSheetProps } from './FilterSheet';
import { EMPTY_FILTERS, FILTER_KINDS } from './filterModel';
import type { FilterOptions } from './filterOptions';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = Object.fromEntries(
  FILTER_KINDS.map((entry) => [entry.kind, []]),
) as unknown as FilterOptions;

function props(onClose: () => void, open: boolean): FilterSheetProps {
  return {
    open,
    shown: 12,
    sort: { key: 'fit', dir: 'desc' } as FilterSheetProps['sort'],
    onSort: vi.fn(),
    onClose,
    onReset: vi.fn(),
    filters: EMPTY_FILTERS,
    options: OPTIONS,
    currency: 'RUB' as FilterSheetProps['currency'],
    onChange: vi.fn(),
    onCurrency: vi.fn(),
    showHidden: false,
    onShowHidden: vi.fn(),
  };
}

const host = document.createElement('div');
afterEach(() => host.replaceChildren());

describe('лист фильтров на 390 (v08, M9-3)', () => {
  it('список ушёл под другой экран («Назад», «Сегодня»): лист закрывается и не висит над страницей', () => {
    host.className = 'b640';
    document.body.appendChild(host);
    const root = createRoot(host);
    const onClose = vi.fn();
    const render = (active: boolean, open: boolean) =>
      act(() =>
        root.render(
          <ScreenActive.Provider value={active}>
            <FilterSheet {...props(onClose, open)} />
          </ScreenActive.Provider>,
        ),
      );
    render(true, true);
    expect(host.querySelector('.vt-sheet[role="dialog"]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    render(false, true);
    expect(host.querySelector('.vt-sheet')).toBeNull();
    expect(host.querySelector('.backdrop')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
