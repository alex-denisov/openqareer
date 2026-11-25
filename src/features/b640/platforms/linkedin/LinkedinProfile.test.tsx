// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../../coach/apiClient';
import { click, mount } from '../../kit/testDom';
import { nodeByCode } from '../../routes';
import Section from '../index';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: () => undefined }),
  useScreenChrome: () => undefined,
}));
vi.mock('./linkedinProfileApi', () => ({
  getLinkedinProfile: vi.fn(),
  markOffersDone: vi.fn(),
  requestOfferVariant: vi.fn(),
}));

const api = await import('./linkedinProfileApi');

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const node = () => {
  const found = nodeByCode('a03');
  if (!found) throw new Error('a03');
  return found;
};
const offer = (key: string, text: string, patch: Record<string, unknown> = {}) => ({ key, variants: [text], doneAt: null, ...patch });
const place = (id: string, label: string, withOffer = false) => ({
  id, label, current: `${label}: сейчас`, offer: withOffer ? offer(`experience:${id}`, `${label}: пересказ`) : null,
});
const sections = (patch: Record<string, unknown> = {}) => [
  { id: 'headline', current: 'Руковожу группой', offer: offer('headline', 'Engineering Manager · платёжная платформа') },
  { id: 'about', current: 'Руковожу группой разработки.', offer: offer('about', 'Руковожу разработкой платёжной платформы.') },
  { id: 'experience', current: null, offer: null, places: [place('e1', 'Финтех Лаб · Тимлид', true), place('e2', 'Сфера · Бэкенд'), place('e3', 'Альфа · Разработчик', true)] },
  { id: 'education', current: 'МГТУ им. Баумана · 2009 — 2014', offer: null },
  { id: 'courses', current: null, offer: null },
  { id: 'skills', current: 'Go · Kotlin', offer: offer('skills', 'Go · Kubernetes') },
  { id: 'languages', current: 'Русский — родной', offer: null },
].map((section) => ({ ...section, ...((patch as Record<string, object>)[section.id] ?? {}) }));

// Поиск по id в jsdom идёт по всему документу: прежние экраны снимаются после каждого теста.
const mounts: Array<ReturnType<typeof mount>> = [];

async function open(view: unknown = { kind: 'ready', sections: sections(), rewriting: false }) {
  vi.mocked(api.getLinkedinProfile).mockResolvedValue(view as never);
  const mounted = mount(<Section node={node()} params={{}} />);
  mounts.push(mounted);
  await flush();
  return mounted;
}
const byText = (root: HTMLElement, selector: string, text: string) =>
  [...root.querySelectorAll<HTMLElement>(selector)].find((item) => item.textContent?.includes(text)) ?? null;
const title = (root: HTMLElement) => root.querySelector('#li-title')!.textContent;

afterEach(() => {
  for (const mounted of mounts.splice(0)) mounted.unmount();
  vi.clearAllMocks();
});

describe('a03: холодный вход (B645)', () => {
  it('пока пересказ готовится — разделы на экране, строка ожидания, экран перечитывается сам', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = { kind: 'ready', sections: sections({ about: { offer: null } }), rewriting: true };
      const ready = { kind: 'ready', sections: sections(), rewriting: false };
      vi.mocked(api.getLinkedinProfile).mockResolvedValueOnce(pending as never).mockResolvedValue(ready as never);
      const mounted = mount(<Section node={node()} params={{}} />);
      mounts.push(mounted);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const root = mounted.container;
      expect(root.querySelectorAll('.li-sec-t')).toHaveLength(7);
      expect(root.textContent).toContain('Готовим тексты для «О себе» и «Опыта»');
      expect(byText(root, '.li-new', 'Руковожу разработкой платёжной платформы.')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(api.getLinkedinProfile).toHaveBeenCalledTimes(2);
      expect(root.textContent).not.toContain('Готовим тексты');
      expect(byText(root, '.li-new', 'Руковожу разработкой платёжной платформы.')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a03: профиль LinkedIn по макету', () => {
  it('семь разделов; «сейчас» из импорта; ни полей вставки, ни строки фактов', async () => {
    const root = (await open()).container;
    expect([...root.querySelectorAll('.li-sec-t')].map((item) => item.textContent)).toEqual([
      'Заголовок', 'О себе', 'Опыт', 'Образование', 'Курсы и сертификаты', 'Навыки', 'Языки',
    ]);
    expect(title(root)).toBe('Изменить 4 раздела из 7');
    expect(root.querySelector('textarea, .li-facts, .li-facts-d')).toBeNull();
    expect(byText(root, 'button', 'Сохранить')).toBeNull();
    expect(byText(root, 'button', 'Применить')).toBeNull();
    expect(byText(root, '#ls-courses ~ .li-rec .li-cur', 'В импорте LinkedIn этого раздела нет')).not.toBeNull();
    expect(root.querySelector('[aria-label="Другой вариант: Заголовок · осталось 3"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Скопировать: Навыки"]')).not.toBeNull();
  });

  it('B801: «Скопировать» с подписью перед «Выполнено» копирует показанный текст; залитая кнопка одна', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const root = (await open()).container;
    const rec = root.querySelector('#ls-headline ~ .li-rec')!;
    const buttons = [...rec.querySelectorAll('.li-offer-a button.btn')];
    expect(buttons.map((item) => item.textContent)).toEqual(['Скопировать', 'Выполнено']);
    click(buttons[0] as HTMLElement);
    await flush();
    expect(writeText).toHaveBeenCalledWith(rec.querySelector('.li-new')!.textContent);
    expect(root.querySelectorAll('.is-primary')).toHaveLength(1);
    // Разделы без предложения — без кнопки.
    expect(root.querySelectorAll('#ls-courses ~ .li-rec button')).toHaveLength(0);
  });

  it('«Опыт» как в «Профиле»: два места на виду, остальные под «Ещё N мест работы»', async () => {
    const root = (await open()).container;
    const more = root.querySelector('.li-sec details.more-n')!;
    expect(more.querySelector('summary')!.textContent).toBe('Ещё 1 место работы · Альфа');
    expect(more.querySelectorAll('.li-rec')).toHaveLength(1);
    expect(root.querySelectorAll('.li-sec .li-rec-l')[0]!.textContent).toBe('Финтех Лаб · Тимлид');
  });

  it('«Выполнено» убирает раздел из счёта; «Опыт» считается, пока есть невыполненное место', async () => {
    vi.mocked(api.markOffersDone).mockImplementation(async (keys) => ({
      done: Object.fromEntries(keys.map((key) => [key, '2026-11-19T10:00:00Z'])),
    }));
    const root = (await open()).container;
    click(byText(root, '#ls-headline ~ .li-rec button', 'Выполнено'));
    await flush();
    expect(api.markOffersDone).toHaveBeenCalledWith(['headline']);
    expect(title(root)).toBe('Изменить 3 раздела из 7');
    expect(root.querySelector('#ls-headline ~ .li-rec .li-done')!.textContent).toBe('Выполнено');
    click(byText(root, '.li-sec button', 'Выполнено'));
    await flush();
    expect(title(root)).toBe('Изменить 2 раздела из 7');
  });

  it('«Отметить все выполненными» отмечает все оставшиеся и прячется', async () => {
    vi.mocked(api.markOffersDone).mockImplementation(async (keys) => ({
      done: Object.fromEntries(keys.map((key) => [key, '2026-11-19T10:00:00Z'])),
    }));
    const root = (await open()).container;
    click(byText(root, '.li-all button', 'Отметить все выполненными'));
    await flush();
    expect(api.markOffersDone).toHaveBeenCalledWith(['headline', 'about', 'experience:e1', 'experience:e3', 'skills']);
    expect(title(root)).toBe('Все предложения выполнены');
    expect(root.querySelector('.li-all')).toBeNull();
  });

  it('«Предложить заново»: новый вариант на экране, «Вариант 2 из 4» и листание назад', async () => {
    vi.mocked(api.requestOfferVariant).mockResolvedValueOnce(
      offer('skills', '', { variants: ['Go · Kubernetes', 'Kubernetes · Go'] }) as never,
    );
    const root = (await open()).container;
    expect(root.querySelector('[aria-label="Варианты: Навыки"]')).toBeNull();
    click(root.querySelector('[aria-label="Другой вариант: Навыки · осталось 3"]'));
    await flush();
    expect(api.requestOfferVariant).toHaveBeenCalledWith('skills');
    expect(root.querySelector('#li-new-skills')!.textContent).toBe('Kubernetes · Go');
    const sw = root.querySelector('[aria-label="Варианты: Навыки"]')!;
    expect(sw.querySelector('.num')!.textContent).toBe('Вариант 2 из 4');
    click(sw.querySelector('[aria-label="Предыдущий вариант"]'));
    expect(root.querySelector('#li-new-skills')!.textContent).toBe('Go · Kubernetes');
    expect(sw.querySelector('.num')!.textContent).toBe('Вариант 1 из 4');
    expect(root.querySelector('[aria-label="Другой вариант: Навыки · осталось 2"]')).not.toBeNull();
  });

  it('модель не ответила — ошибка на месте с «Повторить»', async () => {
    vi.mocked(api.requestOfferVariant).mockRejectedValueOnce(new CoachApiError('x', 'variant_unavailable', true));
    const root = (await open()).container;
    click(root.querySelector('[aria-label="Другой вариант: О себе · осталось 3"]'));
    await flush();
    expect(root.querySelector('.li-err')!.textContent).toContain('Не получилось предложить другой вариант');
  });

  it('варианты кончились в другой вкладке (409) — слова сервера без «Повторить»', async () => {
    vi.mocked(api.requestOfferVariant).mockRejectedValueOnce(
      new CoachApiError('Других вариантов больше не будет.', 'variant_limit_reached', false),
    );
    const root = (await open()).container;
    click(root.querySelector('[aria-label="Другой вариант: О себе · осталось 3"]'));
    await flush();
    expect(root.querySelector('.li-err')!.textContent).toBe('Других вариантов больше не будет.');
    expect(root.querySelector('.li-err button')).toBeNull();
  });

  it('предложений нет вовсе — не «всё выполнено» и без «Отметить все»', async () => {
    const bare = sections().map((section) => ({ ...section, offer: null, ...(section.places ? { places: [] } : {}) }));
    const root = (await open({ kind: 'ready', sections: bare })).container;
    expect(title(root)).toBe('Предложений пока нет');
    expect(root.querySelector('.li-all')).toBeNull();
  });

  it('три варианта — «Предложить заново» недоступна, без подписи', async () => {
    const third = offer('skills', '', { variants: ['Go', 'Go · SQL', 'SQL', 'SQL · Go'] });
    const root = (await open({ kind: 'ready', sections: sections({ skills: { offer: third } }) })).container;
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Другой вариант: Навыки · осталось 0"]')!.disabled).toBe(true);
    expect(root.querySelector('#ls-skills ~ .li-rec .li-err')).toBeNull();
  });

  it('без импорта LinkedIn — «Импортировать из LinkedIn», разделов нет', async () => {
    const root = (await open({ kind: 'no_import' })).container;
    expect(root.querySelector('.li-sec')).toBeNull();
    const link = byText(root, 'a.btn', 'Импортировать из LinkedIn')!;
    expect(link.getAttribute('href')).toBe('/app/account/connections');
  });
});
