// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { B640Node } from '../routes';
import { mount, type Mounted } from '../kit/testDom';
import { ExperienceNewScreen } from './ExperienceNewScreen';

vi.mock('../shell/ShellContext', async (original) => ({
  ...(await original<object>()),
  useShell: () => ({ navigate: vi.fn() }),
}));
vi.mock('../kit', async (original) => ({
  ...(await original<object>()),
  Link: (props: { readonly children?: React.ReactNode }) => <span>{props.children}</span>,
}));

let view: Mounted | null = null;
afterEach(() => view?.unmount());

it('B801: форма нового места — «Что делали», «Результаты» и «Добавить результат»', () => {
  view = mount(<ExperienceNewScreen node={{ code: 'p07', section: 'profile' } as B640Node} />);
  expect(view.container.querySelector('textarea#wk')).not.toBeNull();
  expect(view.container.textContent).toContain('Результаты');
  expect(view.container.textContent).toContain('Добавить результат');
});
