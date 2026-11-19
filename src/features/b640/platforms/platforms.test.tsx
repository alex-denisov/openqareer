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
vi.mock('../../automation/automationApi', () => ({ listCandidateAutomationJournal: vi.fn() }));
vi.mock('./hh/hhRaiseApi', () => ({ getHhRaise: vi.fn(), setHhRaiseEnabled: vi.fn(), retryHhRaise: vi.fn() }));

const coach = await import('../../coach/coachApi');
const apps = await import('../../applications/applicationsApi');
const auto = await import('../../automation/automationApi');
const raise = await import('./hh/hhRaiseApi');

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
const entries = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `j${from + i}`, queueItemId: 'q', platform: 'hh', result: 'delivered', receiptStatus: 'delivered', attempted: true,
    localDate: '2026-11-10', company: `Компания ${from + i}`, occurredAt: '2026-11-10T16:05:00Z', receiptId: null, failureCode: null,
  }));
const journal = (list: unknown[], total = list.length) => ({
  entries: list, periodDays: 30, counts: { total, delivered: total, errors: 0, removed: 0 },
});

afterEach(() => vi.clearAllMocks());

describe('a11: hh.ru', () => {
  it('подключён: «Автоподнятие резюме» по макету, цифры из учёта, без выбора резюме и аналитики', async () => {
    vi.mocked(coach.getConnections).mockResolvedValue([hh('connected')] as never);
    vi.mocked(raise.getHhRaise).mockResolvedValue({
      connected: true, resumeId: 'abc', enabled: false, everyHours: 4,
      lastRaisedAt: null, nextRaiseAt: null, lastResult: null, pausedUntil: null, pauseReason: null,
    } as never);
    vi.mocked(apps.getCandidateActionUsage).mockResolvedValue({ usage: { hhBoostsCount: 1, lastHhBoostAt: '2026-11-16T09:40:00Z' } } as never);
    const view = mount(<Section node={node('a11')} params={{}} />);
    await flush();
    expect(view.container.querySelector('[data-b640-node="a11"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Последнее поднятие');
    const sw = view.container.querySelector<HTMLInputElement>('.hh-sw input#hh-up[role="switch"]');
    expect(sw?.checked).toBe(false);
    expect(view.container.querySelector('.hh-sw label[for="hh-up"]')!.textContent).toBe('Автоподнятие резюме');
    expect(view.container.querySelector('select')).toBeNull();
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

describe('a05c: журнал', () => {
  it('строки по 20 и «Показать ещё», итоги периода, без ответов и реакций', async () => {
    vi.mocked(auto.listCandidateAutomationJournal)
      .mockResolvedValueOnce(journal(entries(20), 25) as never)
      .mockResolvedValueOnce(journal(entries(5, 20), 25) as never);
    const view = mount(<Section node={node('a05c')} params={{}} />);
    await flush();
    expect(view.container.querySelectorAll('li.row')).toHaveLength(20);
    expect(view.container.textContent).toContain('Отправлено');
    expect(view.container.textContent).not.toMatch(/Реакции|Ответы|ответил/);
    click([...view.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Показать ещё')) ?? null);
    await flush();
    expect(view.container.querySelectorAll('li.row')).toHaveLength(25);
    expect(vi.mocked(auto.listCandidateAutomationJournal).mock.calls[1]![0]).toMatchObject({ offset: 20 });
    view.unmount();
  });
  it('пусто: одна строка', async () => {
    vi.mocked(auto.listCandidateAutomationJournal).mockResolvedValue(journal([]) as never);
    const view = mount(<Section node={node('a05c')} params={{}} />);
    await flush();
    expect(view.container.querySelector('.vl-empty-t')!.textContent).toBe('За 30 дней действий не было');
    view.unmount();
  });
  it('ошибка: «Повторить»', async () => {
    vi.mocked(auto.listCandidateAutomationJournal).mockRejectedValueOnce(new Error('x')).mockResolvedValue(journal(entries(1)) as never);
    const view = mount(<Section node={node('a05c')} params={{}} />);
    await flush();
    click([...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Повторить') ?? null);
    await flush();
    expect(view.container.querySelectorAll('li.row')).toHaveLength(1);
    view.unmount();
  });
});
