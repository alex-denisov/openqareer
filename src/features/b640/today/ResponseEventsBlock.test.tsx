// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { mount, type Mounted } from '../kit/testDom';
import { application } from '../responses/model/testApplication';
import { ShellProvider } from '../shell/ShellContext';
import { ResponseEventsBlock } from './ResponseEventsBlock';

const api = vi.hoisted(() => ({ listApplicationsPool: vi.fn() }));
vi.mock('../../applications/applicationsApi', () => api);

const session = {
  username: 't',
  role: 'candidate',
  isTest: true,
  candidateId: 'c',
  features: { cabinetB640: true },
  emailVerified: true,
} as AuthUser;
let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function open(): Promise<HTMLElement> {
  const value = {
    session,
    path: '/app/today',
    search: '',
    match: null,
    consultantRoute: null,
    navigate: vi.fn(),
    signOut: async () => undefined,
    theme: 'light' as const,
    setTheme: () => undefined,
  };
  view = mount(
    <ShellProvider value={value}>
      <ResponseEventsBlock />
    </ShellProvider>,
  );
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
  return view.container;
}

describe('B650 s05b: блок «События откликов»', () => {
  it('недоставленный отклик — карточка с меткой, причиной и действием, как в макете', async () => {
    api.listApplicationsPool.mockResolvedValue({
      items: [
        application({ id: 'ok' }),
        application({
          id: 'a2',
          vacancy: {
            title: 'Руководитель платформы',
            company: 'Карта Технологии',
            url: '',
            source: 'hh',
          },
          deliveryReceipt: { kind: 'failure_note', value: 'Не доставлено: нужен вход в hh.ru' },
          deliveryReceiptRecordedAt: '2026-11-22T10:00:00.000Z',
        }),
      ],
    });
    const root = await open();
    const section = root.querySelector('section.re-today')!;
    expect(section.querySelector('h2.vh')!.textContent).toBe('События откликов');
    const cards = section.querySelectorAll('li.re-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].className).toBe('re-card is-err is-next');
    expect(cards[0].querySelector('.tag.miss')!.textContent).toBe('Не доставлен');
    expect(cards[0].querySelector('a.re-open')!.textContent).toBe(
      'Отклик не доставлен · Карта Технологии',
    );
    expect(cards[0].querySelector('a.re-open')!.getAttribute('href')).toBe('/app/responses/a2');
    expect(cards[0].querySelector('.re-why')!.textContent).toBe(
      'Руководитель платформы · Нужен вход в hh.ru',
    );
    const act2 = cards[0].querySelector('.re-acts a.btn.is-primary')!;
    expect(act2.textContent).toBe('Войти в hh.ru');
    expect(act2.getAttribute('href')).toBe('/app/account/connections');
  });

  it('событий нет или чтение не удалось — блока нет', async () => {
    api.listApplicationsPool.mockResolvedValue({ items: [application()] });
    expect((await open()).querySelector('.re-today')).toBeNull();
    view?.unmount();
    api.listApplicationsPool.mockRejectedValue(new Error('down'));
    expect((await open()).querySelector('.re-today')).toBeNull();
  });
});
