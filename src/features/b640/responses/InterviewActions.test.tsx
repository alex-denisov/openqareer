// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import { ShellProvider } from '../shell/ShellContext';
import { InterviewActions } from './InterviewActions';

let view: Mounted | null = null;

afterEach(() => {
  view?.unmount();
  view = null;
});

const SHELL = {
  session: null,
  path: '/app/responses/r1',
  search: '',
  match: null,
  consultantRoute: null,
  navigate: () => undefined,
  signOut: async () => undefined,
  theme: 'light' as const,
  setTheme: () => undefined,
} as never;

const MARKS = [
  { stage: 'offer', label: 'Прислали оффер' },
  { stage: 'archived', label: 'В архив' },
] as never;

async function render(ahead: boolean, onMark = vi.fn()) {
  await act(async () => {
    view = mount(
      <ShellProvider value={SHELL}>
        <InterviewActions
          responseId="r1"
          ahead={ahead}
          marks={MARKS}
          disabled={false}
          onMark={onMark}
        />
      </ShellProvider>,
    );
  });
  const root = view!.container;
  const links = [...root.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
  return { root, links, onMark };
}

// B645-2: o01c вёл в тупик — входа в подготовку и разбор не было.
describe('InterviewActions: вход в подготовку и разбор из отклика', () => {
  it('до интервью — «Подготовиться к интервью» на I1', async () => {
    const { links } = await render(true);
    expect(links).toEqual([['Подготовиться к интервью', '/app/responses/r1/interview']]);
  });

  it('после интервью — «Разобрать запись» и «Другой способ», как в макете o01c', async () => {
    const { root, links, onMark } = await render(false);
    expect(links).toEqual([
      ['Разобрать запись', '/app/responses/r1/debrief'],
      ['Загрузить файл', '/app/responses/r1/debrief/upload'],
      ['Рассказать своими словами', '/app/responses/r1/debrief#own'],
    ]);
    expect(root.querySelector('summary')?.textContent).toBe('Другой способ');
    const archive = [...root.querySelectorAll('button')].find((b) => b.textContent === 'В архив');
    await act(async () => archive!.click());
    expect(onMark).toHaveBeenCalledWith({ stage: 'archived', label: 'В архив' });
  });
});
