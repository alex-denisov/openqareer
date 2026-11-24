// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getHhResumes: vi.fn(), saveHhResumes: vi.fn() }));
vi.mock('./hh/hhSessionApi', () => api);
vi.mock('../kit', async (original) => ({
  ...(await original<object>()),
  useToast: () => ({ show: vi.fn() }),
}));
import { mount, type Mounted } from '../kit/testDom';
import { HhResumeSelect } from './HhResumeSelect';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

it('выбранное резюме видно сразу, сбой возвращает прежнее', async () => {
  const contents = ['a', 'b'].map((id) => ({ id, title: id, text: id }));
  api.getHhResumes.mockResolvedValue({
    resumes: [
      { id: 'a', title: 'CTO' },
      { id: 'b', title: 'COO' },
    ],
    selected: contents[0],
    contents,
  });
  let fail: (reason: Error) => void = () => undefined;
  api.saveHhResumes.mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  view = await mount(<HhResumeSelect />);
  await act(async () => undefined);
  const select = document.querySelector('select')!;
  await act(async () => {
    select.value = 'b';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(select.value).toBe('b');
  expect(document.body.textContent).toContain('Читаем резюме в hh.ru');
  await act(async () => fail(new Error('x')));
  expect(select.value).toBe('a');
  expect(document.body.textContent).not.toContain('Читаем резюме в hh.ru');
});
