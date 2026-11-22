import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

const WEBHOOK = '/api/v1/integrations/telegram/webhook';
const SECRET = 'webhook-secret-for-tests';
const SMM_CHAT = '-1004373189840';
const CODE = 'A'.repeat(43);
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-telegram-smm-'));
  const config = { ...baseConfig, databasePath: join(directory, 'test.sqlite'), telegramWebhookSecret: SECRET };
  const candidateStore = new SqliteCandidateStore({ databasePath: config.databasePath, encryptionKey: config.dataEncryptionKey });
  const handle = vi.fn();
  const app = await buildApp({
    config,
    candidateStore,
    authService: noSessions,
    coachProvider: {} as never,
    serveStatic: false,
    smmTelegram: { chatId: SMM_CHAT, handle },
  });
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => candidateStore.close(), () => app.close());
  return { app, handle, candidateStore };
}

const post = (app: Awaited<ReturnType<typeof buildApp>>, payload: unknown, secret = SECRET) =>
  app.inject({ method: 'POST', url: WEBHOOK, headers: { 'x-telegram-bot-api-secret-token': secret }, payload: payload as object });

describe('вебхук Telegram: SMM и кандидаты на одном боте (B732)', () => {
  it('сообщение и кнопка из чата SMM уходят обработчику SMM', async () => {
    const { app, handle } = await setup();
    const message = { update_id: 10, message: { message_id: 1, chat: { id: Number(SMM_CHAT) }, text: 'п'.repeat(1_000) } };
    const button = { update_id: 11, callback_query: { id: 'c', data: 'smm:ok', message: { message_id: 2, chat: { id: Number(SMM_CHAT) } } } };
    expect((await post(app, message)).statusCode).toBe(200);
    expect((await post(app, button)).statusCode).toBe(200);
    expect(handle.mock.calls.map(([update]) => update)).toEqual([message, button]);
  });

  it('/start с кодом из личного чата привязывает кандидата, SMM его не видит', async () => {
    const { app, handle, candidateStore } = await setup();
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    candidateStore.notificationRepository.createTelegramLinkCode(
      candidate.id,
      createHash('sha256').update(`openqareer:telegram-link-v1:\0${CODE}`).digest('hex'),
      '2099-01-01T00:00:00.000Z',
    );
    expect((await post(app, { update_id: 12, message: { chat: { id: 777 }, text: `/start ${CODE}` } })).statusCode).toBe(200);
    expect(handle).not.toHaveBeenCalled();
    expect(candidateStore.notificationRepository.getTelegramChat(candidate.id)).toBe('777');
  });

  it('без секрета SMM ничего не получает', async () => {
    const { app, handle } = await setup();
    const response = await post(app, { update_id: 13, message: { chat: { id: Number(SMM_CHAT) }, text: 'x' } }, 'wrong');
    expect(response.statusCode).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });
});
