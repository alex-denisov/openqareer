// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkedinQueueItem, LinkedinRhythm } from '../../../../../shared/b640LinkedinQueue';
import { click, mount } from '../../kit/testDom';
import { CommentQueue } from './CommentQueue';

vi.mock('../../shell/ShellContext', () => ({ useShell: () => ({ navigate: () => undefined }) }));
vi.mock('./linkedinQueueApi', () => ({
  saveRhythm: vi.fn(),
  removeQueueItem: vi.fn(),
  rescheduleQueueItem: vi.fn(),
}));
const api = await import('./linkedinQueueApi');

const RHYTHM: LinkedinRhythm = {
  postsPerWeek: 1,
  days: ['fri'],
  time: '10:00',
  timezone: 'Europe/Moscow',
  comments: { perDay: 2, days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '10:00', to: '18:00' },
};
const item = (id: string, scheduledAt: string): LinkedinQueueItem => ({
  id,
  draftId: id,
  kind: 'comment',
  text: `Комментарий ${id}`,
  scheduledAt,
  state: 'queued',
  updatedAt: scheduledAt,
  remindedAt: null,
  openUrl: null,
});
const ITEMS = [item('q1', '2030-01-07T11:20:00Z'), item('q2', '2030-01-08T07:00:00Z')];
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((node) => node.textContent?.trim() === text)!;

afterEach(() => vi.clearAllMocks());

describe('a05b/a05e: очередь комментариев и ритм', () => {
  it('заголовок по числу, «Следующий —», строки с «Снять с очереди» и журнал', async () => {
    vi.mocked(api.removeQueueItem).mockResolvedValue(undefined as never);
    const onChanged = vi.fn();
    const view = mount(
      <CommentQueue rhythm={RHYTHM} items={ITEMS} onChanged={onChanged} onRhythm={vi.fn()} />,
    );
    expect(view.container.querySelector('h2')!.textContent).toBe('2 комментария в очереди');
    expect(view.container.querySelector('.lk-next-t')!.textContent).toMatch(/^Следующий — /u);
    expect(view.container.querySelectorAll('li.lk-q')).toHaveLength(2);
    expect(view.container.querySelector('li.lk-q .lk-q-t')!.textContent).toBe('Комментарий q1');
    expect(view.container.querySelector('a.btn')!.textContent).toContain('Открыть журнал');
    click(view.container.querySelector('li.lk-q .lk-menu button')!);
    click(button(view.container, 'Снять с очереди'));
    await flush();
    expect(api.removeQueueItem).toHaveBeenCalledWith('q1');
    expect(onChanged).toHaveBeenCalled();
    view.unmount();
  });

  it('«Настроить ритм»: в день, дни, окно — сохраняет на сервере; плохое окно не уходит', async () => {
    const saved = {
      ...RHYTHM,
      comments: {
        perDay: 3,
        days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        from: '09:00',
        to: '18:00',
      },
    };
    vi.mocked(api.saveRhythm).mockResolvedValue(saved as never);
    const onRhythm = vi.fn();
    const view = mount(
      <CommentQueue rhythm={RHYTHM} items={ITEMS} onChanged={vi.fn()} onRhythm={onRhythm} />,
    );
    click(button(view.container, 'Настроить ритм'));
    const pop = view.container.querySelector<HTMLElement>('.va-pop[role="dialog"]')!;
    expect(pop.querySelector('.va-pop-t')!.textContent).toBe('Ритм публикации');
    expect(button(pop, '2').getAttribute('aria-pressed')).toBe('true');
    click(button(pop, '3'));
    click(button(pop, 'Сб'));
    const from = pop.querySelector<HTMLInputElement>('#rh-from')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(from, '19:00');
      from.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(button(pop, 'Сохранить'));
    expect(api.saveRhythm).not.toHaveBeenCalled();
    expect(pop.textContent).toContain('«С» должно быть раньше «до»');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(from, '09:00');
      from.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(button(pop, 'Сохранить'));
    await flush();
    expect(api.saveRhythm).toHaveBeenCalledWith({ ...RHYTHM, comments: saved.comments });
    expect(onRhythm).toHaveBeenCalledWith(saved);
    expect(view.container.querySelector('.va-pop')).toBeNull();
    view.unmount();
  });
});
