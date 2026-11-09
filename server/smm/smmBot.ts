import type { SmmAgent } from './smmAgent';
import { isPostDue, mskDayStart } from './smmSchedule';
import type { SmmPost, SmmStore } from './smmStore';
import {
  TelegramApiError,
  type SmmTelegram,
  type TelegramMessage,
  type TelegramUpdate,
} from './smmTelegram';
import { fetchThreadsPost, findThreadsUrl } from './smmThreadsLink';

const OFFSET_KEY = 'telegram_offset';
const PENDING_KEY = 'pending_action';
const MESSAGE_POST_PREFIX = 'msg_post:';
const METRICS_PATTERN =
  /\d[\d\s.,]*\s*(к|k|тыс)?\s*(просмотр|лайк|views|охват|репост|коммент|подпис|переход)/i;
const RETRY_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const CONFLICT_RETRY_MS = 60_000;
const SCHEDULE_RETRY_MS = 30 * 60_000;
const SCHEDULE_RETRY_MAX_MS = 4 * 60 * 60_000;

/** 409 (второй опрос) и 429 (лимит Telegram) ждут минуту; прочие сбои — 5 с, 10 с … до 5 минут, с разбросом. */
export function pollRetryDelayMs(error: unknown, failures: number): number {
  if (error instanceof TelegramApiError && (error.status === 409 || error.status === 429)) {
    return CONFLICT_RETRY_MS;
  }
  const base = Math.min(RETRY_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export const SMM_BUTTONS = {
  accept: 'Принять',
  reject: 'Отказать',
  correct: 'Скорректировать',
} as const;

const HELP = [
  'Я SMM-агент openqareer: пишу посты Threads от вашего имени, вы публикуете их сами.',
  '/post — новый пост сейчас',
  'Ссылка на пост Threads или снимок экрана — новый пост по его схеме.',
  'Ответ на мой пост с цифрами («1200 просмотров, 40 лайков») — запишу и разберу.',
  'Любой другой текст — разговор о контент-стратегии.',
].join('\n');

export interface SmmBotDeps {
  readonly store: SmmStore;
  readonly agent: SmmAgent;
  readonly telegram: SmmTelegram;
  readonly chatId: string;
  readonly now: () => number;
  readonly log: (event: string, detail?: Record<string, unknown>) => void;
  /** Плановые посты в чат; выключено, пока владелец не утвердит подачу (09.11). */
  readonly autopost?: boolean;
}

function formatDraft(post: SmmPost, check: string): string {
  const body = post.parts.join('\n\n');
  const lines = [`#${post.id} · ${post.cluster}`, '', body];
  if (check) lines.push('', `Проверить: ${check}`);
  return lines.join('\n');
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

export class SmmBot {
  private generating = false;
  private running = false;
  private scheduleFailures = 0;
  private scheduleRetryAfterMs = 0;

  constructor(private readonly deps: SmmBotDeps) {}

  /** Новый черновик в чат с тремя кнопками; message_id запоминаем, чтобы цифры в ответе нашли пост. */
  async deliver(
    result: { post: SmmPost; check: string } | null,
    failureText: string,
  ): Promise<SmmPost | null> {
    const { telegram, chatId, store } = this.deps;
    if (!result) {
      await telegram.send(chatId, failureText);
      return null;
    }
    const id = result.post.id;
    const messageId = await telegram.send(chatId, formatDraft(result.post, result.check), [
      { text: SMM_BUTTONS.accept, callback_data: `smm:a:${id}` },
      { text: SMM_BUTTONS.reject, callback_data: `smm:r:${id}` },
      { text: SMM_BUTTONS.correct, callback_data: `smm:c:${id}` },
    ]);
    if (messageId !== null) store.setState(`${MESSAGE_POST_PREFIX}${messageId}`, String(id));
    return result.post;
  }

  private async exclusive(task: () => Promise<void>): Promise<void> {
    if (this.generating) {
      await this.deps.telegram.send(
        this.deps.chatId,
        'Ещё пишу предыдущий пост, пришлите через минуту.',
      );
      return;
    }
    this.generating = true;
    try {
      await task();
    } finally {
      this.generating = false;
    }
  }

  async generateScheduled(): Promise<SmmPost | null> {
    let post: SmmPost | null = null;
    await this.exclusive(async () => {
      post = await this.deliver(
        await this.deps.agent.scheduledPost(),
        'Не смог написать пост: модели не ответили. Попробую позже.',
      );
      // Без паузы после неудачи каждый тик (5 минут) снова платил бы за вызовы моделей и слал отказ в чат.
      this.scheduleFailures = post ? 0 : this.scheduleFailures + 1;
      this.scheduleRetryAfterMs = post
        ? 0
        : this.deps.now() +
          Math.min(SCHEDULE_RETRY_MS * 2 ** (this.scheduleFailures - 1), SCHEDULE_RETRY_MAX_MS);
    });
    return post;
  }

  /** Тик расписания: пишет пост, если подошёл слот дня. */
  async tick(): Promise<void> {
    const { store, now } = this.deps;
    if (!this.deps.autopost || this.generating || now() < this.scheduleRetryAfterMs) return;
    const due = isPostDue({
      nowMs: now(),
      createdToday: store.countCreatedSince(mskDayStart(now()), 'schedule'),
      acceptedTotal: store.countAccepted(),
      pending: store.countPending(),
      lastCreatedMs: store.recentPosts(1)[0]?.createdMs ?? null,
    });
    if (due) await this.generateScheduled();
  }

  async handle(update: TelegramUpdate): Promise<void> {
    const callback = update.callback_query;
    if (callback) {
      if (String(callback.message?.chat.id) !== this.deps.chatId) return;
      await this.handleCallback(callback.id, callback.data ?? '', callback.message?.message_id);
      return;
    }
    const message = update.message;
    if (!message || String(message.chat.id) !== this.deps.chatId) return;
    await this.handleMessage(message);
  }

  private async handleCallback(
    callbackId: string,
    data: string,
    messageId: number | undefined,
  ): Promise<void> {
    const { store, telegram, chatId, now } = this.deps;
    const match = /^smm:([arc]):(\d{1,10})$/.exec(data);
    const post = match ? store.getPost(Number(match[2])) : null;
    if (!match || !post) {
      await telegram.answerCallback(callbackId, 'Пост не найден');
      return;
    }
    if (post.status !== 'proposed') {
      await telegram.answerCallback(callbackId, 'Решение по этому посту уже есть');
      return;
    }
    if (messageId !== undefined)
      await telegram.clearButtons(chatId, messageId).catch(() => undefined);
    if (match[1] === 'a') {
      store.decide(post.id, 'accepted', null, now());
      await telegram.answerCallback(callbackId, 'Принято');
      await telegram.send(
        chatId,
        `#${post.id} готов к публикации. Каждая часть ниже — отдельным сообщением, копируйте по очереди.`,
      );
      for (const part of post.parts) await telegram.send(chatId, part);
      return;
    }
    if (match[1] === 'r') {
      store.decide(post.id, 'rejected', null, now());
      store.setState(PENDING_KEY, `reject:${post.id}`);
      await telegram.answerCallback(callbackId, 'Отказано');
      await telegram.send(
        chatId,
        `#${post.id} отклонён. Если напишете почему, учту в следующих постах.`,
      );
      return;
    }
    store.setState(PENDING_KEY, `correct:${post.id}`);
    await telegram.answerCallback(callbackId, 'Жду комментарий');
    await telegram.send(
      chatId,
      `Что поправить в #${post.id}? Напишите комментарий, и я перепишу пост.`,
    );
  }

  private postForReply(message: TelegramMessage): SmmPost | null {
    const replyId = message.reply_to_message?.message_id;
    if (replyId === undefined) return null;
    const postId = this.deps.store.getState(`${MESSAGE_POST_PREFIX}${replyId}`);
    return postId ? this.deps.store.getPost(Number(postId)) : null;
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    const text = (message.text ?? message.caption ?? '').trim();
    if (message.photo && message.photo.length > 0) {
      await this.handlePhoto(message.photo[message.photo.length - 1].file_id);
      return;
    }
    if (!text) return;
    if (await this.handleCommand(text)) return;
    if (await this.handlePending(text)) return;
    const threadsUrl = findThreadsUrl(text);
    if (threadsUrl) {
      await this.handleThreadsLink(threadsUrl);
      return;
    }
    await this.handleTalk(message, text);
  }

  private async handlePhoto(fileId: string): Promise<void> {
    const { telegram, chatId, agent } = this.deps;
    await this.exclusive(async () => {
      await telegram.send(chatId, 'Читаю снимок…');
      const bytes = await telegram.downloadPhoto(fileId);
      const seen = bytes ? await agent.readPhoto(bytes) : null;
      if (!seen) {
        await telegram.send(chatId, 'Не смог прочитать снимок. Пришлите текст поста сообщением.');
        return;
      }
      await this.deliver(
        await agent.fromPattern(seen, 'screenshot'),
        'Модели не ответили, пришлите снимок ещё раз.',
      );
    });
  }

  private async handleCommand(text: string): Promise<boolean> {
    const { telegram, chatId, agent } = this.deps;
    if (/^\/(start|help)/.test(text)) {
      await telegram.send(chatId, `${HELP}\n\nchat id: ${chatId}`);
      return true;
    }
    if (!/^\/(post|пост)\b/i.test(text)) return false;
    await this.exclusive(async () => {
      await this.deliver(
        await agent.scheduledPost(),
        'Модели не ответили, попробуйте /post ещё раз.',
      );
    });
    return true;
  }

  /** Ответ на «Скорректировать» или «Отказать»: следующий текст — комментарий к посту. */
  private async handlePending(text: string): Promise<boolean> {
    const { store, telegram, chatId, agent, now } = this.deps;
    const pending = store.getState(PENDING_KEY);
    if (!pending) return false;
    store.setState(PENDING_KEY, null);
    const [kind, id] = pending.split(':');
    const post = store.getPost(Number(id));
    if (post && kind === 'correct') {
      await this.exclusive(async () => {
        await this.deliver(
          await agent.revise(post, text),
          'Не смог переписать: модели не ответили. Нажмите «Скорректировать» ещё раз.',
        );
      });
      return true;
    }
    if (post && kind === 'reject') {
      store.decide(post.id, 'rejected', text, now());
      store.addNote('correction', `Отказ «${post.hook}»: ${text}`, now());
      await telegram.send(chatId, 'Учёл.');
      return true;
    }
    return false;
  }

  private async handleThreadsLink(url: string): Promise<void> {
    const { telegram, chatId, agent } = this.deps;
    await this.exclusive(async () => {
      const external = await fetchThreadsPost(url);
      if (!external) {
        await telegram.send(
          chatId,
          'Threads не отдал текст по ссылке (пост закрыт или удалён). Пришлите снимок экрана.',
        );
        return;
      }
      await this.deliver(
        await agent.fromPattern(external, 'threads_link'),
        'Модели не ответили, пришлите ссылку ещё раз.',
      );
    });
  }

  /** Цифры по посту (ответом на черновик или с #номером) либо разговор об SMM. */
  private async handleTalk(message: TelegramMessage, text: string): Promise<void> {
    const { store, telegram, chatId, agent } = this.deps;
    const repliedPost = this.postForReply(message);
    const numbered = /#(\d+)/.exec(text);
    if (METRICS_PATTERN.test(text) && (repliedPost || numbered)) {
      const post = repliedPost ?? store.getPost(Number(numbered?.[1]));
      await telegram.send(chatId, await agent.recordMetrics(post, text));
      return;
    }
    const answer = await agent.chat(
      repliedPost ? `Про пост #${repliedPost.id} «${repliedPost.hook}»: ${text}` : text,
    );
    await telegram.send(chatId, answer ?? 'Модели сейчас не отвечают, повторите через минуту.');
  }

  /** Длинный опрос Bot API; offset хранится в базе, чтобы выкат не повторял обработку. */
  async poll(): Promise<void> {
    const { store, telegram, log } = this.deps;
    this.running = true;
    let failures = 0;
    while (this.running) {
      try {
        // Всё, что может бросить (в том числе чтение базы), — внутри try: цикл не должен ронять процесс API.
        const offset = Number(store.getState(OFFSET_KEY) ?? '0');
        const updates = await telegram.getUpdates(offset);
        failures = 0;
        for (const update of updates) {
          store.setState(OFFSET_KEY, String(update.update_id + 1));
          await this.handle(update).catch((error: unknown) =>
            log('smm-update-failed', { error: errorName(error) }),
          );
        }
      } catch (error) {
        failures += 1;
        log('smm-poll-failed', {
          error: errorName(error),
          status: error instanceof TelegramApiError ? error.status : null,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, pollRetryDelayMs(error, failures)).unref?.(),
        );
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
