// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../kit', async (original) => ({
  ...(await original<object>()),
  useToast: () => ({ show: vi.fn() }),
}));
import { mount, type Mounted } from '../kit/testDom';
import { HhResumeSelect } from './HhResumeSelect';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

it('выбрать можно любое резюме; выбранное видно сразу, сбой возвращает прежнее', async () => {
  let fail: (reason: Error) => void = () => undefined;
  const onPick = vi.fn(
    () =>
      new Promise<void>((_, reject) => {
        fail = reject;
      }),
  );
  view = await mount(
    <HhResumeSelect
      resumes={[
        { id: 'a', title: 'CTO' },
        { id: 'b', title: 'COO' },
      ]}
      selectedId="a"
      reading={false}
      onPick={onPick}
    />,
  );
  const select = document.querySelector('select')!;
  expect([...select.options].map((option) => option.disabled)).toEqual([false, false]);
  await act(async () => {
    select.value = 'b';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onPick).toHaveBeenCalledWith('b');
  expect(select.value).toBe('b');
  expect(select.disabled).toBe(true);
  await act(async () => fail(new Error('x')));
  expect(select.value).toBe('a');
  expect(select.disabled).toBe(false);
});
