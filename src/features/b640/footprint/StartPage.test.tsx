// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateFootprintAudit } from '../../../../shared/candidateFootprint';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { StartPage } from './FootprintScreen';
import { uncheckedLine } from './footprintModel';
import { repeatIds } from './useStartSearch';
import type { FootprintData } from './useFootprint';

const rememberAddedLink = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./footprintApi', () => ({ rememberAddedLink }));
const resume = vi.hoisted(() => ({
  getResumeStudio: vi.fn(),
  saveResumeStudioDraft: vi.fn(),
}));
vi.mock('../../resume/resumeApi', async (original) => ({
  ...(await original<object>()),
  ...resume,
}));

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

describe('B668: ссылка в «Данных для поиска»', () => {
  it('ссылка на канал добавляется в контакты профиля', async () => {
    resume.getResumeStudio.mockResolvedValue({
      draft: { candidate: { contact: { links: ['https://a.ru/'] } }, experience: [] },
    });
    resume.saveResumeStudioDraft.mockResolvedValue({});
    const changed = vi.fn();
    window.addEventListener('b640:footprint-changed', changed);
    const root = render(data('ready', audit('completed', ['checked'])));
    click([...root.querySelectorAll('button')].find((item) => item.textContent === 'Изменить')!);
    const input = root.querySelector<HTMLInputElement>('#fp-link')!;
    const type = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const submit = () =>
      act(async () => {
        input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    type('не адрес');
    await submit();
    expect(root.querySelector('#fp-link-e')?.textContent).toBe('Это не адрес страницы');
    type('youtube.com/@name');
    await submit();
    expect(resume.saveResumeStudioDraft).toHaveBeenCalledTimes(1);
    const saved = resume.saveResumeStudioDraft.mock.calls[0]![0];
    expect(saved.candidate.contact.links).toEqual(['https://a.ru/', 'https://youtube.com/@name']);
    expect(rememberAddedLink).toHaveBeenCalledWith('https://youtube.com/@name');
    expect(changed).toHaveBeenCalled();
    window.removeEventListener('b640:footprint-changed', changed);
  });
});

describe('B668: «Проверить снова»', () => {
  it('прежний выбор и добавленная ссылка; снятое раньше не возвращается', () => {
    const value = {
      ...data('ready', {
        ...audit('completed', ['checked']),
        selectedQueryIds: ['a'],
        addedQueryIds: ['new', 'gone'],
      }),
      plan: ['a', 'unticked', 'new'].map((id) => ({
        id,
        kind: 'profile_url' as const,
        preview: id,
        selectedByDefault: true,
        available: true,
      })),
    };
    expect(repeatIds(value)).toEqual(['a', 'new']);
  });
});
