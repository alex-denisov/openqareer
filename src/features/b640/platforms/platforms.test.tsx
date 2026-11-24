// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount } from '../kit/testDom';
import { nodeByCode } from '../routes';
import Section from './index';

vi.mock('../shell/ShellContext', () => ({
  useShell: () => ({ navigate: () => undefined }),
  useScreenChrome: () => undefined,
}));
vi.mock('../../coach/coachApi', () => ({ getConnections: vi.fn() }));
vi.mock('../../applications/applicationsApi', () => ({ getCandidateActionUsage: vi.fn() }));
vi.mock('../apply/hh/hhSessionApi', () => ({ getHhResumes: vi.fn(async () => null) }));
vi.mock('./hh/hhRaiseApi', () => ({ getHhRaise: vi.fn(), setHhRaiseEnabled: vi.fn(), retryHhRaise: vi.fn() }));
vi.mock('./journal/journalApi', () => ({ getLinkedinJournal: vi.fn() }));

const coach = await import('../../coach/coachApi');
const apps = await import('../../applications/applicationsApi');
const raise = await import('./hh/hhRaiseApi');
const li = await import('./journal/journalApi');

const flush = () => act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
const node = (code: string) => {
  const found = nodeByCode(code);
  if (!found) throw new Error(code);
  return found;
};
const hh = (status: 'connected' | 'disconnected') =>
  status === 'connected'
    ? { platform: 'hh', available: true, capabilities: [], importsCareerHistory: true, status, accessMode: 'native_session_snapshot', connectedAt: '2026-11-01T10:00:00Z', lastImportedAt: '2026-11-03T10:00:00Z', factCount: 3 }
    : { platform: 'hh', available: true, capabilities: [], importsCareerHistory: true, status };
const events = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `queue:q${from + i}`, kind: 'post_published', at: '2026-11-10T13:05:00Z', text: `Пост ${from + i}`, url: null, contact: null,
  }));
const reply = { id: 'reply:pavel', kind: 'replied', at: '2026-11-11T13:05:00Z', text: null, url: null, contact: { id: 'pavel', name: 'Павел Ким' } };
const journal = (list: unknown[], total = list.length) => ({
  events: list, total, offset: 0, limit: 20, month: { month: '2026-11-01', posts: total, comments: 0, replies: 0 },
});

afterEach(() => vi.clearAllMocks());

describe('a11: hh.ru', () => {
  it('подключён: «Автоподнятие резюме» по макету, цифры из учёта, поле «Резюме», без аналитики', async () => {
    vi.mocked(coach.getConnections).mockResolvedValue([hh('connected')] as never);
    vi.mocked(raise.getHhRaise).mockResolvedValue({
      connected: true, resumeId: 'abc', resumes: [{ id: 'abc', title: 'Инженер' }], enabled: false, everyHours: 4,
      lastRaisedAt: null, nextRaiseAt: null, lastResult: null, pausedUntil: null, pauseReason: null, pending: false,
    } as never);
    vi.mocked(apps.getCandidateActionUsage).mockResolvedValue({ usage: { hhBoostsCount: 1, lastHhBoostAt: '2026-11-16T09:40:00Z' } } as never);
    const view = mount(<Section node={node('a11')} params={{}} />);
    await flush();
    expect(view.container.querySelector('[data-b640-node="a11"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Последнее поднятие');
    const sw = view.container.querySelector<HTMLInputElement>('.hh-sw input#hh-up[role="switch"]');
    expect(sw?.checked).toBe(false);
    expect(view.container.querySelector('.hh-sw label[for="hh-up"]')!.textContent).toBe('Автоподнятие резюме');
    expect(view.container.querySelectorAll('.hh-cv select option')).toHaveLength(1);
    expect(view.container.textContent).not.toMatch(/Просмотры|Приглашения/);
    expect(view.container.querySelectorAll('button')).toHaveLength(1);
    view.unmount();
  });
  it('не подключён: строка площадки со ссылкой «Подключить»', async () => {
    vi.mocked(coach.getConnections).mockResolvedValue([hh('disconnected')] as never);
    vi.mocked(apps.getCandidateActionUsage).mockRejectedValue(new Error('x'));
    const view = mount(<Section node={node('a11')} params={{}} />);
    await flush();
    expect(view.container.querySelector('.src-title')!.textContent).toContain('hh.ru');
    expect(view.container.querySelector('a[aria-label="Подключить hh.ru"]')).not.toBeNull();
    view.unmount();
  });
  it('учёт недоступен: экран остаётся, показывает дату данных', async () => {
    vi.mocked(coach.getConnections).mockResolvedValue([hh('connected')] as never);
    vi.mocked(apps.getCandidateActionUsage).mockRejectedValue(new Error('x'));
    const view = mount(<Section node={node('a11')} params={{}} />);
    await flush();
    expect(view.container.textContent).toContain('Данные из резюме обновлены');
    expect(view.container.textContent).not.toContain('Поднятий сегодня');
    view.unmount();
  });
  it('ошибка: «Повторить» читает заново', async () => {
    vi.mocked(coach.getConnections).mockRejectedValueOnce(new Error('x')).mockResolvedValue([hh('disconnected')] as never);
    const view = mount(<Section node={node('a11')} params={{}} />);
    await flush();
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    click([...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Повторить') ?? null);
    await flush();
    expect(view.container.querySelector('.src-title')).not.toBeNull();
    view.unmount();
  });
});

describe('a05c: журнал LinkedIn', () => {
  it('строки по 20 и «Показать ещё», итоги месяца без реакций', async () => {
    vi.mocked(li.getLinkedinJournal)
      .mockResolvedValueOnce(journal(events(20), 25) as never)
      .mockResolvedValueOnce(journal(events(5, 20), 25) as never);
    const view = mount(<Section node={node('a05c')} params={{}} />);
    await flush();
    expect(view.container.querySelectorAll('li.row')).toHaveLength(20);
    expect(view.container.querySelector('#jl-title')!.textContent).toBe('Журнал LinkedIn');
    // B645-2: без карточки «ответил» заголовок раздела — заголовок страницы (lead-title, xl).
    expect(view.container.querySelector('#jl-title')!.className).toBe('lead-title');
    expect(view.container.querySelector('#jn-sum')!.textContent).toBe('За ноябрь');
    expect(view.container.textContent).not.toMatch(/Реакции|реакци/);
    expect(view.container.querySelector('.lead')).toBeNull();
    click([...view.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Показать ещё')) ?? null);
    await flush();
    expect(view.container.querySelectorAll('li.row')).toHaveLength(25);
    expect(vi.mocked(li.getLinkedinJournal).mock.calls[1]![0]).toBe(20);
    view.unmount();
  });
  it('«ответил» ведёт экран: «Павел ответил» и «Написать Павлу» в черновик контакта', async () => {
    vi.mocked(li.getLinkedinJournal).mockResolvedValue(journal([reply, ...events(2)]) as never);
    const view = mount(<Section node={node('a05c')} params={{}} />);
    await flush();
    expect(view.container.querySelector('.lead-title')!.textContent).toBe('Павел ответил');
    const write = view.container.querySelector<HTMLAnchorElement>('.lead a.btn.is-primary')!;
    expect(write.textContent).toBe('Написать Павлу');
    expect(write.getAttribute('href')).toMatch(/#write-pavel$/u);
    expect(view.container.querySelector('li.row .tag.ok')!.textContent).toBe('ответил');
    view.unmount();
  });
  it('пусто: одна строка, без итогов', async () => {
    vi.mocked(li.getLinkedinJournal).mockResolvedValue(journal([]) as never);
    const view = mount(<Section node={node('a05c')} params={{}} />);
    await flush();
    expect(view.container.querySelector('.vl-empty-t')!.textContent).toBe('Событий LinkedIn пока нет');
    expect(view.container.querySelector('#jn-sum')).toBeNull();
    view.unmount();
  });
  it('ошибка: «Повторить»', async () => {
    vi.mocked(li.getLinkedinJournal).mockRejectedValueOnce(new Error('x')).mockResolvedValue(journal(events(1)) as never);
    const view = mount(<Section node={node('a05c')} params={{}} />);
    await flush();
    click([...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Повторить') ?? null);
    await flush();
    expect(view.container.querySelectorAll('li.row')).toHaveLength(1);
    view.unmount();
  });
});
