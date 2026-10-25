// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VacancyCompanyPathPanel } from './VacancyCompanyPathPanel';
import * as api from './vacancyLetterApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const circles: api.VacancyConnectionCircles = {
  vacancyId: 'v1',
  companyKey: 'vector',
  companyName: 'Вектор Банк',
  vacancyTitle: 'Head of Engineering',
  circles: [
    { circle: 1, state: 'none', message: '', paths: [] },
    { circle: 2, state: 'unknown', message: '', paths: [] },
    { circle: 3, state: 'available', message: 'Подготовьте холодный отклик.', paths: [] },
  ],
  linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mount(actions = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<VacancyCompanyPathPanel id="p" vacancyId="v1" actions={actions} />);
  });
  await act(async () => {});
  return host;
}

describe('VacancyCompanyPathPanel (B549)', () => {
  it('renders three circles from the circles API and routes actions', async () => {
    vi.spyOn(api, 'getVacancyConnectionCircles').mockResolvedValue(circles);
    const onShowPaths = vi.fn();
    const onPrepareLetter = vi.fn();
    const host = await mount({ onShowPaths, onPrepareLetter });
    expect(host.textContent).toContain('Как откликнуться: три круга связей');
    expect(host.textContent).toContain('Знакомых в Вектор Банк не найдено.');
    expect(host.textContent).toContain('Контакты неизвестны');
    const buttons = Array.from(host.querySelectorAll('li button')) as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Добавить контакты',
      'Добавить контакты',
      'Подготовить письмо',
    ]);
    buttons[0]!.click();
    buttons[2]!.click();
    expect(onShowPaths).toHaveBeenCalledTimes(1);
    expect(onPrepareLetter).toHaveBeenCalledTimes(1);
  });

  it('B510: every circle action carries a leading icon, as .career-btn.is-sm in mockup 4', async () => {
    vi.spyOn(api, 'getVacancyConnectionCircles').mockResolvedValue(circles);
    const host = await mount({ onShowPaths: vi.fn(), onPrepareLetter: vi.fn() });
    const buttons = Array.from(host.querySelectorAll('li button'));
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    }
  });

  it('treats a malformed response as an error instead of crashing', async () => {
    vi.spyOn(api, 'getVacancyConnectionCircles').mockResolvedValue({} as never);
    const host = await mount();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить');
  });

  it('shows an error with a retry', async () => {
    const spy = vi.spyOn(api, 'getVacancyConnectionCircles').mockRejectedValueOnce(new Error('x'));
    spy.mockResolvedValueOnce(circles);
    const host = await mount();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить');
    await act(async () => {
      (host.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    });
    await act(async () => {});
    expect(host.textContent).toContain('Холодный отклик');
  });

  it('opens the letter on the circle the card names (G5 A4)', async () => {
    const { companyPathActions } = await import('./VacancyCompanyPathPanel');
    const onOpenLetter = vi.fn();
    const target = { id: 'c-1' } as never;
    const actions = companyPathActions(target, { onOpenLetter }, vi.fn());
    actions.onPrepareLetter?.();
    actions.onAskIntro?.();
    expect(onOpenLetter.mock.calls).toEqual([
      [target, 3],
      [target, 2],
    ]);
  });
});
