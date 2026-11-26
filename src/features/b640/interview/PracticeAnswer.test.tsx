// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { createInterviewSession } from '../../../../server/domain/interviewSimulator';
import { buildSystemDesignTask } from '../../../../server/domain/systemDesignTask';
import type { InterviewSessionView } from '../../interview/interviewSimulatorApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { PracticeAnswer } from './PracticeAnswer';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  vi.unstubAllGlobals();
});

const button = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].find((item) =>
    item.textContent?.includes('Закончить и разобрать'),
  )!;

function type(root: HTMLElement, value: string): void {
  const field = root.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function render(startedAt: string) {
  const session = createInterviewSession({
    id: 's1',
    mode: 'text',
    roleTitle: 'Руководитель',
    applicationId: 'r1',
    questionTypes: ['system_design'],
    stressMode: false,
    stories: [],
    questionIds: ['q1'],
    now: startedAt,
  }) as unknown as InterviewSessionView;
  view = mount(
    <PracticeAnswer
      task={buildSystemDesignTask({ vacancyTitle: 'Руководитель' })}
      company={null}
      session={session}
      recovery={{ draft: undefined, onLost: vi.fn(), onFinished: vi.fn() }}
    />,
  );
  return view.container;
}

it('B647: «Напишите ответ» гаснет после ввода', () => {
  const root = render(new Date().toISOString());
  click(button(root));
  expect(root.textContent).toContain('Напишите ответ');
  type(root, 'Шлюз API');
  expect(root.textContent).not.toContain('Напишите ответ');
});

it('B647: через семь часов клиент шлёт не больше часа', async () => {
  const fetchMock = vi.fn(
    async (_url: unknown, _init?: RequestInit) => new Response('{}', { status: 500 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const root = render(new Date(Date.now() - 7 * 3_600_000).toISOString());
  type(root, 'Шлюз API');
  await act(async () => button(root).click());
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/answers'));
  expect(JSON.parse(String(call?.[1]?.body)).elapsedSeconds).toBe(3_600);
});
