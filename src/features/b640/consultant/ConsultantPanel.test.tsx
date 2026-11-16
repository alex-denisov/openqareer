// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../coach/apiClient';
import type { AuthUser, CandidateMemory } from '../../coach/coachApi';
import { click, mount, press, type Mounted } from '../kit/testDom';
import { ShellProvider } from '../shell/ShellContext';
import { ConsultantPanel, type PanelView } from './ConsultantPanel';
import { panelPath, panelViewOf } from './index';

const api = vi.hoisted(() => ({
  getCandidateWithMessages: vi.fn(),
  sendCoachTurn: vi.fn(),
  changeMemory: vi.fn(),
  fetchTariffQuotas: vi.fn(),
  fetchConversationPage: vi.fn(),
  fetchConversation: vi.fn(),
}));

vi.mock('../../coach/candidateSnapshotApi', () => ({
  getCandidateWithMessages: api.getCandidateWithMessages,
}));
vi.mock('../../coach/coachApi', async (original) => ({
  ...(await original<typeof import('../../coach/coachApi')>()),
  sendCoachTurn: api.sendCoachTurn,
  changeMemory: api.changeMemory,
}));
vi.mock('../../tariffs/tariffQuotaApi', async (original) => ({
  ...(await original<typeof import('../../tariffs/tariffQuotaApi')>()),
  fetchTariffQuotas: api.fetchTariffQuotas,
}));
vi.mock('./consultantApi', () => ({
  fetchConversationPage: api.fetchConversationPage,
  fetchConversation: api.fetchConversation,
}));

const session: AuthUser = {
  username: 'flagged.test',
  email: null,
  displayName: 'Мария Соколова',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-1',
  features: { cabinetB640: true },
};

const fact: CandidateMemory = {
  id: 'fact-1',
  kind: 'fact',
  domain: 'outcome',
  statement: 'Сфера Платежи — команда 18 человек',
  confidence: 'candidate-reported',
  sourceMessageIds: ['u1'],
  sensitive: false,
  status: 'proposed',
};

const feed = [
  { id: 'u1', role: 'user', content: 'Команда была 18 человек.' },
  { id: 'a1', role: 'assistant', content: 'Принято.\n\nЭто нужно записать в профиль.' },
];

function quotas(remaining: number) {
  return {
    plan: 'free',
    unlimited: false,
    period: { startedAt: '2026-10-20T00:00:00.000Z', endsAt: '2026-11-20T09:00:00.000Z' },
    quotas: [
      { key: 'coach_turns', label: 'Сообщения', limit: 30, used: 30 - remaining, remaining, upgradePlan: 'basic' },
    ],
    fitPercentLimit: null,
  };
}

let view: Mounted | null = null;
const navigate = vi.fn();
const onView = vi.fn();
const onClose = vi.fn();

async function open(panel: PanelView): Promise<HTMLElement> {
  const value = {
    session,
    path: '/app/consultant',
    search: '',
    match: null,
    navigate,
    signOut: async () => undefined,
    theme: 'light' as const,
    setTheme: () => undefined,
  };
  view = mount(
    <ShellProvider value={value}>
      <ConsultantPanel
        view={panel}
        stage="vacancies"
        named
        pathOf={panelPath}
        onView={onView}
        onClose={onClose}
      />
    </ShellProvider>,
  );
  await settle();
  return view.container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

function ask(root: HTMLElement, value: string): HTMLTextAreaElement {
  const area = root.querySelector('textarea.cmp-in') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  press(area, 'Enter');
  return area;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getCandidateWithMessages.mockResolvedValue({ messages: feed, memory: [fact] });
  api.fetchTariffQuotas.mockResolvedValue(quotas(12));
  api.changeMemory.mockResolvedValue(undefined);
});
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('панель консультанта: разговор (K1)', () => {
  it('шапка и лента по макету, без «Нового разговора» и названий моделей', async () => {
    const root = await open({ kind: 'dialog' });
    expect(api.getCandidateWithMessages).toHaveBeenCalledWith('vacancies');
    const panel = root.querySelector('aside.panel-col') as HTMLElement;
    expect(panel.querySelector('.panel-head.ph2 .ph-title.ph-conv')?.textContent).toBe(
      'Консультант · Вакансии',
    );
    const back = panel.querySelector('a.ph-back') as HTMLAnchorElement;
    expect(back.getAttribute('aria-label')).toBe('Все разговоры');
    expect(back.getAttribute('href')).toBe('/app/consultant/history');
    expect(panel.querySelector('.ph-new')).toBeNull();
    expect(panel.querySelector('.msg.me')?.textContent).toBe('Команда была 18 человек.');
    expect(panel.querySelectorAll('.msg.bot p')).toHaveLength(2);
    expect(panel.textContent).not.toMatch(/gemini|gpt|claude|openrouter|vertex/iu);
    click(panel.querySelector('[aria-label="Свернуть"]'));
    expect(onClose).toHaveBeenCalled();
  });

  it('запись из разговора: строка сверху и карточка; «Верно» пишет в профиль на месте', async () => {
    const root = await open({ kind: 'dialog' });
    const pend = root.querySelector('.ptop a.pend') as HTMLAnchorElement;
    expect(pend.textContent).toBe('1 запись ждёт проверки');
    expect(pend.getAttribute('href')).toBe('/app/profile/review');
    const card = root.querySelector('section.ec.fc') as HTMLElement;
    expect(card.querySelector('.ec-title')?.textContent).toBe(
      'Записать в профиль: Сфера Платежи — команда 18 человек',
    );
    const labels = [...card.querySelectorAll('.msg-acts.act-row .btn')].map((b) => b.textContent);
    expect(labels).toEqual(['Верно', 'Исправить', 'Не нужно']);
    click(card.querySelector('.btn.is-write'));
    await settle();
    expect(api.changeMemory).toHaveBeenCalledWith('fact-1', { action: 'confirm' });
    expect(root.querySelector('section.ec.fc')).toBeNull();
    expect(root.querySelector('.chat .res-row')?.textContent).toBe('Записано в профиль');
    expect(root.querySelector('.ptop')).toBeNull();
  });

  it('«Не нужно» убирает запись, сбой показан в карточке', async () => {
    const root = await open({ kind: 'dialog' });
    api.changeMemory.mockRejectedValueOnce(new Error('сеть'));
    click(root.querySelectorAll('section.ec.fc .btn.is-line')[1]);
    await settle();
    expect(root.querySelector('section.ec.fc .res-row.is-err')?.textContent).toBe('Не сохранилось');
    click(root.querySelectorAll('section.ec.fc .btn.is-line')[1]);
    await settle();
    expect(api.changeMemory).toHaveBeenLastCalledWith('fact-1', { action: 'delete' });
    expect(root.querySelector('section.ec.fc')).toBeNull();
  });

  it('вопрос сразу в ленте, ответ пишется на месте и остаётся в ленте', async () => {
    let finish: (value: { message: string }) => void = () => undefined;
    let stream: (text: string) => void = () => undefined;
    api.sendCoachTurn.mockImplementation((input: { onMessageText: (text: string) => void }) => {
      stream = input.onMessageText;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const root = await open({ kind: 'dialog' });
    const area = ask(root, 'А что с Гринкодом?');
    expect(area.value).toBe('');
    expect([...root.querySelectorAll('.msg.me')].at(-1)?.textContent).toBe('А что с Гринкодом?');
    expect(root.querySelector('.typing')?.textContent).toBe('Консультант печатает');
    expect(api.sendCoachTurn.mock.calls[0][0]).toMatchObject({
      content: 'А что с Гринкодом?',
      stage: 'vacancies',
    });
    act(() => stream('Гринкод просит'));
    expect(root.querySelector('.msg.bot[aria-busy="true"]')?.textContent).toBe('Гринкод просит');
    await act(async () => finish({ message: 'Гринкод просит собрать команду.' }));
    await settle();
    expect(root.querySelector('.typing')).toBeNull();
    expect(root.querySelector('.msg.bot[aria-busy]')).toBeNull();
  });

  it('ответ не пришёл: вопрос остаётся, «Повторить» шлёт его тем же ключом', async () => {
    api.sendCoachTurn.mockRejectedValueOnce(new CoachApiError('сбой', 'provider_failed', true));
    const root = await open({ kind: 'dialog' });
    ask(root, 'Как это сформулировать?');
    await settle();
    const error = root.querySelector('.chat > .res-row.is-err') as HTMLElement;
    expect(error.querySelector('.res-t')?.textContent).toBe('Ответ не пришёл');
    expect([...root.querySelectorAll('.msg.me')].at(-1)?.textContent).toBe(
      'Как это сформулировать?',
    );
    // Пока вопрос без ответа, набранное следом не уходит и не теряется.
    const area = ask(root, 'Ещё вопрос');
    expect(area.value).toBe('Ещё вопрос');
    expect(api.sendCoachTurn).toHaveBeenCalledTimes(1);
    api.sendCoachTurn.mockResolvedValueOnce({ message: 'Вот формулировка.' });
    click(error.querySelector('.res-act'));
    await settle();
    expect(api.sendCoachTurn).toHaveBeenCalledTimes(2);
    const [first, second] = api.sendCoachTurn.mock.calls.map((call) => call[0]);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.messageId).toBe(first.messageId);
    expect(root.querySelector('.chat > .res-row.is-err')).toBeNull();
  });

  it('предел (K3): ввод закрыт, строка называет дату и ведёт к тарифам', async () => {
    api.sendCoachTurn.mockRejectedValueOnce(
      new CoachApiError('Лимит', 'quota_exhausted', false, {}, { upgradePlan: 'basic' }),
    );
    const root = await open({ kind: 'dialog' });
    ask(root, 'Как это сформулировать?');
    await settle();
    const form = root.querySelector('form.compose.cmp.is-off') as HTMLFormElement;
    expect(form.querySelector('.cmp-line-t')?.textContent).toBe(
      'Лимит сообщений исчерпан · обновится 20 ноября',
    );
    const link = form.querySelector('a.cmp-line-a') as HTMLAnchorElement;
    expect(link.textContent).toBe('Перейти на Basic');
    expect(link.getAttribute('href')).toBe('/app/tariffs');
    expect((form.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    expect((form.querySelector('.cmp-send') as HTMLButtonElement).disabled).toBe(true);
    expect(root.querySelector('.chat > .res-row.is-err')).toBeNull();
  });

  it('остаток 0 закрывает ввод сразу при открытии', async () => {
    api.fetchTariffQuotas.mockResolvedValue(quotas(0));
    const root = await open({ kind: 'dialog' });
    expect(root.querySelector('form.compose.is-off .cmp-line')).not.toBeNull();
  });

  it('лента не загрузилась: строка с «Повторить» на месте ленты', async () => {
    api.getCandidateWithMessages.mockRejectedValueOnce(new Error('сеть'));
    const root = await open({ kind: 'dialog' });
    const error = root.querySelector('.chat > .res-row.is-err') as HTMLElement;
    expect(error.querySelector('.res-t')?.textContent).toBe('Разговор не загрузился');
    click(error.querySelector('.res-act'));
    await settle();
    expect(root.querySelector('.chat > .res-row.is-err')).toBeNull();
    expect(root.querySelector('.msg.me')).not.toBeNull();
  });
});

describe('панель консультанта: все разговоры (K5)', () => {
  const row = (id: string, firstPhrase: string) => ({
    id,
    stage: 'vacancies',
    openedAt: '2026-11-10T10:00:00.000Z',
    lastMessageAt: '2026-11-10T10:05:00.000Z',
    closedAt: '2026-11-10T11:00:00.000Z',
    messageCount: 4,
    firstPhrase,
    summary: null,
  });

  it('темы одной строкой, «Показать ещё» дочитывает следующую порцию', async () => {
    api.fetchConversationPage
      .mockResolvedValueOnce({ items: [row('c1', 'С чего начать поиск')], nextCursor: 'next' })
      .mockResolvedValueOnce({ items: [row('c2', 'Что писать о себе')], nextCursor: null });
    const root = await open({ kind: 'history' });
    expect(root.querySelector('.ph-title')?.textContent).toBe('Все разговоры');
    expect(root.querySelector('.ph-back')).toBeNull();
    const first = root.querySelector('ul.hist.hist2 a.hist-t.hist-row') as HTMLAnchorElement;
    expect(first.querySelector('.hist-tt')?.textContent).toBe('С чего начать поиск');
    expect(first.getAttribute('href')).toBe('/app/consultant?conversation=c1');
    click(root.querySelector('.vl-foot .btn'));
    await settle();
    expect(api.fetchConversationPage).toHaveBeenLastCalledWith('next');
    expect(root.querySelectorAll('ul.hist li')).toHaveLength(2);
    expect(root.querySelector('.vl-foot')).toBeNull();
  });

  it('пусто (K5b): одна строка и «Начать»', async () => {
    api.fetchConversationPage.mockResolvedValueOnce({ items: [], nextCursor: null });
    const root = await open({ kind: 'history' });
    expect(root.querySelector('.vl-empty-t')?.textContent).toBe('Разговоров пока нет');
    click(root.querySelector('.vl-empty .btn.is-primary'));
    expect(onView).toHaveBeenCalledWith({ kind: 'dialog' });
  });

  it('сбой списка: «Повторить» на месте', async () => {
    api.fetchConversationPage
      .mockRejectedValueOnce(new Error('сеть'))
      .mockResolvedValueOnce({ items: [row('c1', 'Тема')], nextCursor: null });
    const root = await open({ kind: 'history' });
    expect(root.querySelector('.res-row.is-err .res-t')?.textContent).toBe(
      'Разговоры не загрузились',
    );
    click(root.querySelector('.res-row.is-err .res-act'));
    await settle();
    expect(root.querySelectorAll('ul.hist li')).toHaveLength(1);
  });

  it('прошлый разговор открывается лентой с датой и путём назад к списку', async () => {
    api.fetchConversation.mockResolvedValueOnce({
      ...row('c1', 'Тема'),
      messages: [
        { id: 'm1', role: 'user', content: 'С чего начать поиск', createdAt: '2026-11-10T10:00:00.000Z' },
        { id: 'm2', role: 'assistant', content: 'С профиля.', createdAt: '2026-11-10T10:01:00.000Z' },
      ],
    });
    const root = await open({ kind: 'conversation', id: 'c1' });
    expect(api.fetchConversation).toHaveBeenCalledWith('c1');
    expect(root.querySelector('.chat .day')?.textContent).toBe('10 ноября');
    expect(root.querySelector('.msg.me')?.textContent).toBe('С чего начать поиск');
    expect(root.querySelector('a.ph-back')?.getAttribute('href')).toBe('/app/consultant/history');
    expect(root.querySelector('form.compose')).toBeNull();
  });
});

describe('адреса видов панели', () => {
  it('вид читается из узла и параметра адреса и собирается обратно', () => {
    expect(panelViewOf('k05', '')).toEqual({ kind: 'history' });
    expect(panelViewOf('k01', '')).toEqual({ kind: 'dialog' });
    expect(panelViewOf('k01', '?conversation=c%201')).toEqual({ kind: 'conversation', id: 'c 1' });
    expect(panelPath({ kind: 'conversation', id: 'c 1' })).toBe('/app/consultant?conversation=c%201');
    expect(panelPath({ kind: 'history' })).toBe('/app/consultant/history');
    expect(panelPath({ kind: 'dialog' })).toBe('/app/consultant');
  });
});
