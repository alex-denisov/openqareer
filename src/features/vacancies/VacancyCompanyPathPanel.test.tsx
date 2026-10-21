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
});
