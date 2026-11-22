import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { SmmAgent } from './smmAgent';
import { SmmBot } from './smmBot';
import type { ChatTurn, SmmModel } from './smmModel';
import { SmmStore } from './smmStore';
import { createSmmTelegram } from './smmTelegram';
import type { InlineButton, SmmTelegram, TelegramUpdate } from './smmTelegram';
import type { LinkReaderDeps } from './smmLinkReader';

const CHAT = '-100777';
const VALID = JSON.stringify({
  cluster: 'зарплаты и переговоры',
  hook: 'Вы уж меня простите, но вилку называют первыми не просто так',
  parts: [
    '1/2 Вы уж меня простите, но вилку называют первыми не просто так.',
    '2/2 Вилки по ролям: https://openqareer.com/salaries',
  ],
  link: 'https://openqareer.com/salaries',
  check: 'ничего',
});

interface Sent {
  text: string;
  buttons?: readonly InlineButton[];
}

const variant = (hook: string) => ({
  cluster: 'резюме и отклик',
  hook,
  parts: [`${hook}. Дальше по делу.`],
  link: '',
  check: '',
});
const EXAMPLE = JSON.stringify({
  breakdown: {
    hook: 'Признание с цифрой в первой строке',
    structure: 'Проблема, поворот, три приема',
    tone: 'Разговорный, от первого лица',
    cta: 'Вопрос к читателю',
  },
  variants: [
    variant('Мой отклик читали шесть секунд'),
    variant('Я перестал писать письма'),
    variant('Рекрутер видит три слова'),
  ],
});
const ARTICLE_HTML =
  '<html><head><meta property="og:title" content="Почему отклик читают за шесть секунд"><meta name="author" content="Иван Петров"></head>' +
  '<body><article><p>Первые строки отклика решают всё: если в них нет задачи, которую вы решили, дальше не читают.</p></article></body></html>';
const articleLinks: LinkReaderDeps = { readPage: async () => ({ ok: true, html: ARTICLE_HTML }) };

function setup(replies: Array<string | null> = [VALID], links?: LinkReaderDeps) {
  const store = new SmmStore(new DatabaseSync(':memory:'));
  const prompts: ChatTurn[][] = [];
  const model: SmmModel = {
    async complete(turns, accept) {
      prompts.push([...turns]);
      const next = replies.length > 1 ? replies.shift() : replies[0];
      return next && (!accept || accept(next)) ? next : null;
    },
    async readImage() {
      return 'Автор: x. Текст: Я В ШОКЕ, как просто… 1/5 …';
    },
  };
  const sent: Sent[] = [];
  let nextId = 100;
  const telegram: SmmTelegram = {
    async send(_chat, text, buttons) {
      sent.push({ text, buttons });
      return nextId++;
    },
    async answerCallback() {},
    async clearButtons() {},
    async downloadPhoto() {
      return new Uint8Array([1, 2, 3]);
    },
  };
  const now = () => Date.UTC(2026, 10, 9, 9, 0);
  const agent = new SmmAgent({ store, model, ownerBrief: () => 'Имя: Алексей Денисов', now });
  const bot = new SmmBot({
    store,
    agent,
    telegram,
    chatId: CHAT,
    now,
    log: () => {},
    autopost: true,
    links,
  });
  return { store, bot, sent, prompts };
}

const message = (text: string, extra: Record<string, unknown> = {}): TelegramUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: Number(CHAT) }, text, ...extra },
});
const press = (data: string): TelegramUpdate => ({
  update_id: 2,
  callback_query: { id: 'cb', data, message: { message_id: 100, chat: { id: Number(CHAT) } } },
});

describe('SmmBot', () => {
  it('ignores every chat except the SMM chat', async () => {
    const { bot, sent } = setup();
    await bot.handle({ update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/post' } });
    expect(sent).toHaveLength(0);
  });

  it('sends a draft with the three owner buttons', async () => {
    const { bot, sent } = setup();
    await bot.handle(message('/post'));
    expect(sent[0].text).toContain('#1 · зарплаты и переговоры');
    expect(sent[0].buttons?.map((b) => b.text)).toEqual(['Принять', 'Отказать', 'Скорректировать']);
  });

  it('accept sends each part as plain text to copy', async () => {
    const { bot, sent, store } = setup();
    await bot.handle(message('/post'));
    await bot.handle(press('smm:a:1'));
    expect(store.getPost(1)?.status).toBe('accepted');
    expect(sent.slice(-2).map((s) => s.text)).toEqual(store.getPost(1)?.parts);
    expect(store.getPost(1)?.link).toBeNull();
    expect(sent.at(-1)?.text).not.toContain('https://');
    expect(sent.slice(-2).every((s) => !s.buttons)).toBe(true);
  });

  it('a decided post cannot be decided twice', async () => {
    const { bot, store } = setup();
    await bot.handle(message('/post'));
    await bot.handle(press('smm:r:1'));
    await bot.handle(press('smm:a:1'));
    expect(store.getPost(1)?.status).toBe('rejected');
  });

  it('correct asks for a comment and regenerates, remembering the correction', async () => {
    const { bot, sent, store, prompts } = setup();
    await bot.handle(message('/post'));
    await bot.handle(press('smm:c:1'));
    expect(sent.at(-1)?.text).toContain('Что поправить');
    await bot.handle(message('короче и без капса'));
    expect(store.getPost(1)?.status).toBe('revised');
    expect(store.getPost(2)?.status).toBe('proposed');
    expect(store.recentNotes('correction', 5)[0]).toContain('короче и без капса');
    expect(prompts.at(-1)?.[1].content).toContain('короче и без капса');
  });

  it('a screenshot is broken down like a link, wrapped as untrusted data', async () => {
    const { bot, sent, prompts } = setup([EXAMPLE]);
    await bot.handle(
      message('', { photo: [{ file_id: 'f' }], text: undefined, caption: 'про отказы' }),
    );
    expect(sent.at(-1)?.buttons).toHaveLength(3);
    expect(prompts.at(-1)?.[1].content).toContain('<untrusted_example>');
    expect(prompts.at(-1)?.[1].content).toContain('Тема владельца: про отказы');
  });

  it('a link: the model gets the page text, not the address alone', async () => {
    const { bot, prompts } = setup([EXAMPLE], articleLinks);
    await bot.handle(message('https://habr.com/ru/articles/1/ отказы без причины'));
    const task = prompts.at(-1)?.[1].content ?? '';
    expect(task).toContain('Первые строки отклика решают всё');
    expect(task).toContain('«Почему отклик читают за шесть секунд», автор Иван Петров');
    expect(task).toContain('Тема владельца: отказы без причины');
    expect(task).not.toContain('habr.com');
  });

  it('a link: breakdown first, then each variant waits for the owner with its own buttons', async () => {
    const { bot, sent, store } = setup([EXAMPLE], articleLinks);
    await bot.handle(message('https://habr.com/ru/articles/1/'));
    const breakdown = sent.find((s) => s.text.startsWith('Разбор примера'));
    expect(breakdown?.text).toContain('Хук: Признание с цифрой в первой строке');
    expect(breakdown?.text).toContain('Финал: Вопрос к читателю');
    expect(sent.filter((s) => s.buttons?.length === 3)).toHaveLength(3);
    expect(
      store.recentPosts(5).every((p) => p.status === 'proposed' && p.origin === 'example'),
    ).toBe(true);
  });

  it('a page that cannot be read: one honest line, a screenshot request, no model call', async () => {
    const { bot, sent, prompts } = setup([EXAMPLE], {
      readPage: async () => ({ ok: false, reason: 'failed' }),
    });
    await bot.handle(message('https://medium.com/@a/post-1'));
    expect(sent.at(-1)?.text).toBe(
      'Не смог прочитать medium.com, текст я не видел. Пришлите снимок экрана.',
    );
    expect(prompts).toHaveLength(0);
  });

  it('fewer than two usable variants is not delivered as a breakdown', async () => {
    const one = JSON.stringify({ ...JSON.parse(EXAMPLE), variants: [variant('Один вариант')] });
    const { bot, sent } = setup([one], articleLinks);
    await bot.handle(message('https://habr.com/ru/articles/1/'));
    expect(sent.some((s) => s.text.startsWith('Разбор примера'))).toBe(false);
    expect(sent.at(-1)?.text).toBe('Модели не ответили, пришлите пример еще раз.');
  });

  it('a reply to a draft with a link is a metrics report, not a new example', async () => {
    const readPage = vi.fn(async () => ({ ok: true as const, html: ARTICLE_HTML }));
    const { bot, store } = setup([VALID, 'Хороший охват.'], { readPage });
    await bot.handle(message('/post'));
    await bot.handle(
      message('1200 просмотров, вот пост https://www.threads.com/@a/post/X', {
        reply_to_message: { message_id: 100 },
      }),
    );
    expect(readPage).not.toHaveBeenCalled();
    expect(store.getPost(1)?.metrics).toContain('1200 просмотров');
  });

  it('page title and author reach the model only as untrusted data', async () => {
    const { bot, prompts } = setup([EXAMPLE], articleLinks);
    await bot.handle(message('https://habr.com/ru/articles/1/'));
    expect(prompts.at(-1)?.[1].content).toMatch(
      /<untrusted_example_source>\n«Почему отклик читают за шесть секунд», автор Иван Петров\n<\/untrusted_example_source>/u,
    );
  });

  it('/мой saves the owner post; it and his strong posts set the voice, weak strategy posts do not', async () => {
    const { bot, store, prompts, sent } = setup([EXAMPLE], articleLinks);
    await bot.handle(
      message('/мой Я нанял пятьсот человек и ни разу не читал сопроводительное письмо целиком.'),
    );
    expect(sent.at(-1)?.text).toMatch(/^Сохранил ваш пост #1/u);
    const strong = store.addPost(
      {
        cluster: 'поиск работы',
        hook: 'сильный',
        parts: ['Сильный пост стратегии'],
        link: null,
        origin: 'schedule',
      },
      1,
    );
    const weak = store.addPost(
      {
        cluster: 'поиск работы',
        hook: 'слабый',
        parts: ['Слабый пост стратегии'],
        link: null,
        origin: 'schedule',
      },
      2,
    );
    const mid = store.addPost(
      {
        cluster: 'поиск работы',
        hook: 'средний',
        parts: ['Средний пост по примеру'],
        link: null,
        origin: 'threads_link',
      },
      3,
    );
    for (const post of [strong, weak, mid]) store.decide(post.id, 'accepted', null, 4);
    store.setMetrics(strong.id, '3,1к просмотров, 25 переходов');
    store.setMetrics(weak.id, '40 просмотров');
    store.setMetrics(mid.id, '900 просмотров');
    await bot.handle(message('https://habr.com/ru/articles/1/'));
    const task = prompts.at(-1)?.[1].content ?? '';
    expect(task).toContain('<untrusted_owner_posts>');
    expect(task.indexOf('ни разу не читал')).toBeLessThan(task.indexOf('Сильный пост стратегии'));
    expect(task).toContain('Средний пост по примеру');
    expect(task).not.toContain('Слабый пост стратегии');
  });

  it('numbers in a reply to a draft are stored as performance', async () => {
    const { bot, store } = setup([VALID, 'Хороший охват, повторите хук.']);
    await bot.handle(message('/post'));
    await bot.handle(
      message('1200 просмотров, 40 лайков', { reply_to_message: { message_id: 100 } }),
    );
    expect(store.getPost(1)?.metrics).toBe('1200 просмотров, 40 лайков');
    expect(store.recentNotes('performance', 1)[0]).toContain('1200 просмотров');
  });

  it('strategy agreed in chat is saved to memory', async () => {
    const { bot, store, sent } = setup([
      'Согласен.\nСТРАТЕГИЯ: два поста в день про руководителей',
    ]);
    await bot.handle(message('давай больше про руководителей'));
    expect(sent.at(-1)?.text).toContain('Согласен');
    expect(store.recentNotes('strategy', 1)[0]).toContain('два поста в день про руководителей');
  });

  it('a draft with an invented percentage is not delivered', async () => {
    const bad = VALID.replace('не просто так.', 'не просто так: 62% вакансий без вилки.');
    const { bot, sent, store } = setup([bad]);
    await bot.handle(message('/post'));
    expect(store.recentPosts(5)).toHaveLength(0);
    expect(sent.at(-1)?.text).toContain('Модели не ответили');
  });

  it('tells the owner when no model answered', async () => {
    const { bot, sent, store } = setup([null]);
    await bot.handle(message('/post'));
    expect(sent.at(-1)?.text).toContain('Модели не ответили');
    expect(store.recentPosts(5)).toHaveLength(0);
  });

  it('schedule writes a post once the morning slot has come', async () => {
    const { bot, store } = setup();
    await bot.tick();
    expect(store.recentPosts(5)).toHaveLength(1);
  });

  it('after a failed scheduled post it waits instead of retrying every tick', async () => {
    const { bot, sent, store } = setup([null]);
    await bot.tick();
    await bot.tick();
    await bot.tick();
    expect(sent.filter((s) => s.text.includes('Не смог написать пост'))).toHaveLength(1);
    expect(store.recentPosts(5)).toHaveLength(0);
  });

  it('a repeated webhook update is handled once (B732)', async () => {
    const { bot, sent } = setup();
    await bot.receive({ ...message('/post'), update_id: 50 });
    const after = sent.length;
    await bot.receive({ ...message('/post'), update_id: 50 });
    await bot.receive({ ...message('/post'), update_id: 49 });
    expect(after).toBeGreaterThan(0);
    expect(sent).toHaveLength(after);
  });

  it('a handler error is logged, not thrown into the webhook (B732)', async () => {
    const { store, bot } = setup();
    vi.spyOn(store, 'getState').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    await expect(bot.receive(message('/post'))).resolves.toBeUndefined();
  });
});

describe('SMM без опроса Bot API (B732)', () => {
  it('клиент SMM не умеет getUpdates: обновления приходят вебхуком', () => {
    const fetchImpl = vi.fn();
    expect(
      Object.keys(createSmmTelegram('1:x', fetchImpl as unknown as typeof fetch)),
    ).not.toContain('getUpdates');
  });
});

describe('autopost flag', () => {
  it('does not post on schedule until the owner turns autopost on', async () => {
    const { store } = setup();
    const quiet = new SmmBot({
      store,
      agent: { scheduledPost: async () => null } as never,
      telegram: { send: async () => 1 } as never,
      chatId: CHAT,
      now: () => Date.UTC(2026, 10, 9, 9, 0),
      log: () => {},
    });
    await quiet.tick();
    expect(store.recentPosts(5)).toHaveLength(0);
  });
});
