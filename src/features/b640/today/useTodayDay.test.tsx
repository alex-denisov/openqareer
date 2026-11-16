// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as todayApi from '../../today/todayApi';
import type { TodaySnapshot } from '../../today/todayApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { useTodayDay, type TodayDay } from './useTodayDay';

/** Форма ответа прода 16.11: `dueAt` и `fit` пустые, у поста — `draftId`. */
const SNAPSHOT = {
  digest: { waitingForYou: 3, newVacancies: 0, nextInterview: null },
  queue: [
    {
      kind: 'follow_up',
      applicationId: 'app-1',
      title: 'Director of Engineering, AI Functions',
      company: 'Snowflake',
      eyebrow: 'ответа нет 47 дней',
      dueAt: '2026-10-05T00:00:00.000Z',
      fit: null,
    },
    {
      kind: 'linkedin_post',
      draftId: 'd-1',
      title: 'о найме',
      company: 'LinkedIn',
      eyebrow: 'сам не опубликуется',
      dueAt: null,
      fit: null,
    },
  ],
  followUps: [],
  sinceLastVisit: { since: null, items: [] },
  vacanciesPending: false,
  queueTotal: 3,
  queueRevision: 'r1',
  queueOffset: 0,
  connectedSources: ['linkedin'],
} as unknown as TodaySnapshot;

let view: Mounted | null = null;
let day: TodayDay | null = null;
let errors: ReturnType<typeof vi.spyOn>;

function Probe() {
  day = useTodayDay();
  return (
    <button type="button" onClick={() => void day?.refresh()}>
      {day.failed ? 'failed' : day.snapshot ? `rows:${day.snapshot.queue.length}` : 'loading'}
    </button>
  );
}

const text = () => view?.container.querySelector('button')?.textContent;
const settle = () => act(async () => void (await vi.runAllTimersAsync()));

beforeEach(() => {
  vi.useFakeTimers();
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(todayApi, 'recordCandidateVisit').mockResolvedValue({ since: null });
});

afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTodayDay: чтение дня для нового «Сегодня»', () => {
  it('читает день в форме прода', async () => {
    vi.spyOn(todayApi, 'getTodaySnapshot').mockResolvedValue(SNAPSHOT);
    view = mount(<Probe />);
    expect(text()).toBe('loading');
    await settle();
    expect(text()).toBe('rows:2');
    expect(errors).not.toHaveBeenCalled();
  });

  it('сбой отметки визита не мешает прочитать день, причина — в консоли', async () => {
    vi.spyOn(todayApi, 'recordCandidateVisit').mockRejectedValue(new Error('visit down'));
    vi.spyOn(todayApi, 'getTodaySnapshot').mockResolvedValue(SNAPSHOT);
    view = mount(<Probe />);
    await settle();
    expect(text()).toBe('rows:2');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('визит'), expect.any(Error));
  });

  it('медленный первый ответ: повторяет чтение сам и не показывает ошибку', async () => {
    const read = vi
      .spyOn(todayApi, 'getTodaySnapshot')
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
      .mockResolvedValueOnce(SNAPSHOT);
    view = mount(<Probe />);
    await settle();
    expect(text()).toBe('rows:2');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('три сбоя подряд: ошибка на экране, причина в консоли, «Повторить» читает заново', async () => {
    const read = vi.spyOn(todayApi, 'getTodaySnapshot').mockRejectedValue(new Error('boom'));
    view = mount(<Probe />);
    await settle();
    expect(text()).toBe('failed');
    expect(read).toHaveBeenCalledTimes(3);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('«Сегодня»'),
      expect.objectContaining({ message: 'boom' }),
    );
    read.mockResolvedValue(SNAPSHOT);
    click(view.container.querySelector('button'));
    await settle();
    expect(text()).toBe('rows:2');
  });

  it('после ухода с экрана ничего не повторяет и не пишет', async () => {
    const read = vi.spyOn(todayApi, 'getTodaySnapshot').mockRejectedValue(new Error('boom'));
    view = mount(<Probe />);
    view.unmount();
    view = null;
    await act(async () => void (await vi.runAllTimersAsync()));
    expect(read.mock.calls.length).toBeLessThanOrEqual(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it('догружает остальные дела очереди', async () => {
    vi.spyOn(todayApi, 'getTodaySnapshot').mockResolvedValue(SNAPSHOT);
    const more = vi.spyOn(todayApi, 'getTodayQueueRemainder').mockResolvedValue({
      queue: [{ ...SNAPSHOT.queue[1], draftId: 'd-2' }],
      queueTotal: 3,
      queueRevision: 'r1',
      queueOffset: 2,
    });
    view = mount(<Probe />);
    await settle();
    await act(async () => void (await day?.loadQueueRemainder()));
    expect(text()).toBe('rows:3');
    expect(more).toHaveBeenCalledWith(expect.any(String), 2, 'r1');
  });

  it('сбой догрузки: флаг ошибки и причина в консоли, показанные дела остаются', async () => {
    vi.spyOn(todayApi, 'getTodaySnapshot').mockResolvedValue(SNAPSHOT);
    vi.spyOn(todayApi, 'getTodayQueueRemainder').mockRejectedValue(new Error('more down'));
    view = mount(<Probe />);
    await settle();
    await act(async () => void (await day?.loadQueueRemainder()));
    expect(text()).toBe('rows:2');
    expect(day?.queueRemainderFailed).toBe(true);
    expect(errors).toHaveBeenCalled();
  });
});
