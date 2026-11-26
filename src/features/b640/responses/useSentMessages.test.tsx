// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../messages/contactMessageApi';
import { useSentMessages } from './useSentMessages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../messages/contactMessageApi', () => ({ listB640SentMessages: vi.fn() }));

const SENT = [{ id: 'm1', kind: 'known_contact', recipientName: 'Роман Ефимов', sentAt: '2026-11-06T09:00:00.000Z' }] as const;

function Probe({ vacancyId }: { readonly vacancyId: string | undefined }) {
  const messages = useSentMessages(vacancyId);
  return <p>{messages.map((message) => message.recipientName).join(',') || 'нет'}</p>;
}

async function render(vacancyId: string | undefined) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Probe vacancyId={vacancyId} />));
  await act(async () => Promise.resolve());
  return { host, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  vi.mocked(api.listB640SentMessages).mockReset();
  document.body.innerHTML = '';
});

describe('useSentMessages', () => {
  it('читает отправленные по вакансии отклика', async () => {
    vi.mocked(api.listB640SentMessages).mockResolvedValue(SENT);
    const view = await render('cl-1');
    expect(api.listB640SentMessages).toHaveBeenCalledWith('cl-1', expect.any(AbortSignal));
    expect(view.host.textContent).toBe('Роман Ефимов');
    view.unmount();
  });

  it('без вакансии не ходит на сервер', async () => {
    const view = await render(undefined);
    expect(api.listB640SentMessages).not.toHaveBeenCalled();
    expect(view.host.textContent).toBe('нет');
    view.unmount();
  });

  it('сбой чтения оставляет историю без сообщений', async () => {
    vi.mocked(api.listB640SentMessages).mockRejectedValue(new Error('down'));
    const view = await render('cl-1');
    expect(view.host.textContent).toBe('нет');
    view.unmount();
  });
});
