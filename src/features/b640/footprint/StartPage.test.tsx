// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateFootprintAudit } from '../../../../shared/candidateFootprint';
import { mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { StartPage } from './FootprintScreen';
import { uncheckedLine } from './footprintModel';
import type { FootprintData } from './useFootprint';

vi.mock('./footprintApi', () => ({}));

const adapter = (state: string) => ({ adapterId: 'x', state });
const audit = (state: string, adapters: readonly string[]) =>
  ({
    state,
    adapterStatuses: adapters.map(adapter),
    findings: [],
  }) as unknown as CandidateFootprintAudit;
const data = (summaryState: string, current: CandidateFootprintAudit): FootprintData =>
  ({
    plan: [],
    consentGranted: true,
    consentVersion: 'v1',
    consentGrantedAt: null,
    audit: current,
    summary: {
      state: summaryState,
      checkedAt: null,
      total: 0,
      toRemove: 0,
      headline: null,
      categories: [],
      items: [],
    },
  }) as unknown as FootprintData;

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function render(value: FootprintData): HTMLElement {
  const node = nodeByCode('f01');
  if (!node) throw new Error('f01');
  view = mount(<StartPage node={node} data={value} reload={() => undefined} />);
  return view.container;
}

describe('F1: состояние поиска вверху страницы, как в макете (f02, f02b)', () => {
  it('во время поиска — полоса «Проверено категорий» над формой', () => {
    const root = render(
      data(
        'checking',
        audit('pending', ['checked', 'checked', 'pending', 'pending', 'pending', 'not_run']),
      ),
    );
    const bar = root.querySelector(
      '.page.pf > .pf-state > progress.pf-prog',
    ) as HTMLProgressElement;
    expect(bar.getAttribute('aria-label')).toBe('Проверено категорий');
    expect([bar.value, bar.max]).toEqual([2, 5]);
    expect(root.querySelector('.page.pf')!.firstElementChild!.className).toBe('pf-state');
  });

  it('после сбоя — «N категории не проверены» с «Повторить» над формой', () => {
    const root = render(
      data('ready', audit('completed', ['source_error', 'source_error', 'checked'])),
    );
    const line = root.querySelector('.page.pf > .pf-state > .li-err')!;
    expect(line.getAttribute('role')).toBe('alert');
    expect(line.textContent).toContain('2 категории не проверены');
    expect(line.querySelector('button')!.textContent).toContain('Повторить');
  });

  it('без сбоя и не во время поиска — блока нет', () => {
    const root = render(data('ready', audit('completed', ['checked'])));
    expect(root.querySelector('.pf-state')).toBeNull();
  });

  it('склонение строки сбоя', () => {
    expect([1, 2, 5, 21, 12].map(uncheckedLine)).toEqual([
      '1 категория не проверена',
      '2 категории не проверены',
      '5 категорий не проверены',
      '21 категория не проверена',
      '12 категорий не проверены',
    ]);
  });
});
