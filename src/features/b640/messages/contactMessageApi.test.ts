import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  approveB640ContactMessage,
  createB640ContactMessage,
  editB640ContactMessage,
  markB640ContactMessageSent,
} from './contactMessageApi';

const fetchMock = vi.fn();
vi.mock('../../coach/apiClient', async (original) => ({
  ...(await original<typeof import('../../coach/apiClient')>()),
  apiFetch: (...args: unknown[]) => fetchMock(...args),
}));

afterEach(() => fetchMock.mockReset());

const ok = (data: unknown, status = 200) => ({ ok: true, status, json: async () => ({ data }) });

describe('contactMessageApi', () => {
  it('создаёт черновик: contactId и вид сообщения', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'm1' }, 201));
    await createB640ContactMessage({ contactId: 'c7' }, 'ask_introduction');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/candidate/b640/contact-messages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ contactId: 'c7', kind: 'ask_introduction' });
  });

  it('для рекрутёра шлёт recruiterId и vacancyId', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'm2' }, 201));
    await createB640ContactMessage({ recruiterId: 'r1', vacancyId: 'v1' }, 'recruiter');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      recruiterId: 'r1',
      vacancyId: 'v1',
      kind: 'recruiter',
    });
  });

  it('правка шлёт только текст', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'm1', text: 'Привет' }));
    const message = await editB640ContactMessage('m1', 'Привет');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/candidate/b640/contact-messages/m1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ text: 'Привет' });
    expect(message.text).toBe('Привет');
  });

  it('одобрение и «отправил» — POST на свои адреса', async () => {
    fetchMock.mockResolvedValueOnce(ok({ openUrl: 'https://www.linkedin.com/in/x' }));
    const approval = await approveB640ContactMessage('m1');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/candidate/b640/contact-messages/m1/approve');
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
    expect(approval.openUrl).toBe('https://www.linkedin.com/in/x');
    fetchMock.mockResolvedValueOnce(ok({ sentAt: '2026-11-19T10:00:00.000Z' }));
    const sent = await markB640ContactMessageSent('m1');
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/candidate/b640/contact-messages/m1/sent');
    expect(sent.sentAt).toBe('2026-11-19T10:00:00.000Z');
  });

  it('ошибка сервера бросает исключение', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: 'message_not_approved', message: 'Сначала одобрите сообщение.' },
      }),
    });
    await expect(markB640ContactMessageSent('m1')).rejects.toThrow();
  });
});
