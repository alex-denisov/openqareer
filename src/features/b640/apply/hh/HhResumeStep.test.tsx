// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../kit/testDom';

const api = vi.hoisted(() => ({
  getHhResumes: vi.fn(),
  getHhResumeEdits: vi.fn(),
  saveHhResumes: vi.fn(),
  chooseHhResumeFor: vi.fn(),
}));
const desktop = vi.hoisted(() => ({ readHhResumeContent: vi.fn() }));
const bridge = vi.hoisted(() => ({ isTauriEnvironment: vi.fn() }));
vi.mock('./hhSessionApi', () => api);
vi.mock('./hhDesktop', async (original) => ({ ...(await original<object>()), ...desktop }));
vi.mock('../../../../services/desktop/desktopBridge', async (original) => ({
  ...(await original<object>()),
  ...bridge,
}));
vi.mock('../../kit', async (original) => ({
  ...(await original<object>()),
  useToast: () => ({ show: vi.fn() }),
}));
import { HhResumeStep } from './HhResumeStep';

const SECTIONS = {
  title: 'IT Директор / CIO / CTO',
  about: 'Руковожу ИТ 15 лет.',
  skills: ['ITIL'],
  places: [{ employer: 'Россети', title: 'CIO', period: '2020 — 2023', text: 'Вёл поддержку' }],
};
const RESUMES = [
  { id: 'cio', title: 'IT Директор / CIO / CTO' },
  { id: 'coo', title: 'COO' },
];
const READ = {
  resumes: RESUMES,
  selected: { id: 'cio', title: RESUMES[0]!.title, text: 'x', sections: SECTIONS },
  readAt: 'x',
};

let view: Mounted | null = null;
const onConfirm = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  api.getHhResumes.mockResolvedValue(READ);
  api.getHhResumeEdits.mockResolvedValue({ edits: [] });
  bridge.isTauriEnvironment.mockReturnValue(false);
  desktop.readHhResumeContent.mockRejectedValue(new Error('hh_resume_not_read'));
});
afterEach(() => view?.unmount());

async function render(): Promise<string> {
  view = await mount(
    <HhResumeStep vacancyId="v1" confirmed={false} onConfirm={onConfirm} dock={null} />,
  );
  await act(async () => undefined);
  await act(async () => undefined);
  return view.container.textContent ?? '';
}
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(text))!;

it('показывает резюме hh.ru вакансии и его содержимое, без листа PDF', async () => {
  const text = await render();
  expect(api.getHhResumes).toHaveBeenCalledWith(expect.anything(), 'v1');
  for (const part of ['CIO', 'Вёл поддержку', 'ITIL', 'Руковожу ИТ 15 лет.'])
    expect(text).toContain(part);
  expect(document.querySelector('.cv-stage')).toBeNull();
  expect(text).not.toContain('Скачать');
  click(button('Одобрить резюме'));
  expect(onConfirm).toHaveBeenCalledOnce();
});

it('выбор хранится за вакансией', async () => {
  api.chooseHhResumeFor.mockResolvedValue({
    ...READ,
    selected: { ...READ.selected, id: 'coo', title: 'COO' },
  });
  await render();
  const select = document.querySelector('select')!;
  await act(async () => {
    select.value = 'coo';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(api.chooseHhResumeFor).toHaveBeenCalledWith('v1', 'coo');
  expect(api.saveHhResumes).not.toHaveBeenCalled();
  expect(select.value).toBe('coo');
});

it('чтение без опыта — не прочиталось: правки не запрашиваются, в приложении можно повторить', async () => {
  bridge.isTauriEnvironment.mockReturnValue(true);
  api.getHhResumes.mockResolvedValue({
    ...READ,
    selected: {
      ...READ.selected,
      sections: { ...SECTIONS, places: [], about: 'Уровень дохода не указан' },
    },
  });
  const text = await render();
  expect(text).toContain('не прочиталось');
  expect(text).not.toContain('Уровень дохода');
  expect(api.getHhResumeEdits).not.toHaveBeenCalled();
  expect(desktop.readHhResumeContent).toHaveBeenCalledTimes(1);
  await act(async () => click(button('Повторить')));
  expect(desktop.readHhResumeContent).toHaveBeenCalledTimes(2);
});

it('в браузере непрочитанное резюме сразу названо непрочитанным, hh.ru не читается', async () => {
  api.getHhResumes.mockResolvedValue({ ...READ, selected: { id: 'coo', title: 'COO', text: '' } });
  expect(await render()).toContain('не прочиталось');
  expect(desktop.readHhResumeContent).not.toHaveBeenCalled();
});

it('правки — без «Применить» в браузере', async () => {
  api.getHhResumeEdits.mockResolvedValue({
    edits: [{ id: 'skills', section: 'skills', was: 'ITIL', now: 'ITIL, SQL', added: ['SQL'] }],
  });
  const text = await render();
  expect(text).toContain('1 правка под эту вакансию');
  expect(button('Применить')).toBeUndefined();
});

it('в браузере без прочитанных резюме — без выбора, в приложении — «Выбрать резюме hh.ru»', async () => {
  api.getHhResumes.mockResolvedValue(null);
  await render();
  expect(document.querySelector('select')).toBeNull();
  expect(button('К письму')).toBeTruthy();
  view?.unmount();
  bridge.isTauriEnvironment.mockReturnValue(true);
  await render();
  expect(button('Выбрать резюме hh.ru')).toBeTruthy();
});
