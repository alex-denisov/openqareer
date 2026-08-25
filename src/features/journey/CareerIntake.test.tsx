import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CareerIntake, IMPORT_ACTION_LABEL, PRESS_IMPORT_FIRST_MESSAGE } from './CareerIntake';

describe('CareerIntake', () => {
  beforeEach(() => {
    // Clean environment
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  /**
   * B169 §4 — the wizard used to open on a welcome screen whose only action
   * was «Начать диагностику». It restated the first question without asking
   * it, and the owner could not tell what it was for. The first paint is now
   * the first question.
   */
  it('opens on the first question, with no screen in front of it', () => {
    const html = renderToStaticMarkup(<CareerIntake onComplete={() => undefined} />);

    expect(html).toContain('С чем разобраться?');
    expect(html).not.toContain('Начать диагностику');
    expect(html).not.toContain('Начните с карьерного вопроса');
  });

  it('asks for the import action by the name the button actually carries', () => {
    expect(PRESS_IMPORT_FIRST_MESSAGE).toContain(`«${IMPORT_ACTION_LABEL}»`);
    expect(PRESS_IMPORT_FIRST_MESSAGE).not.toContain('Импортировать по ссылке');
  });

  it('offers the no-document route from the source step itself', () => {
    const html = renderToStaticMarkup(
      <CareerIntake onComplete={() => undefined} initialStep="source" />,
    );

    expect(html).toContain('Без документов');
  });

  it('selects PDF by default on the web source step', () => {
    const html = renderToStaticMarkup(
      <CareerIntake
        onComplete={() => undefined}
        initialStep="source"
      />,
    );

    expect(html).toContain('Импорт профиля');
    expect(html).toContain('career-pdf-source');
    expect(html).toContain('Выбрать PDF');
    expect(html).toContain('файл читается в браузере');
    expect(html).toContain('в профиль отправляется извлечённый текст');
    expect(html).toContain('исходный файл не сохраняется');
    expect(html).not.toContain('разбор идёт на нашем сервере');
    expect(html).not.toContain('career-web-desktop-cta');
  });

  it('renders two platform cards for LinkedIn and hh.ru in desktop mode', () => {
    // Mock Tauri desktop companion environment
    (globalThis as { window?: unknown }).window = {
      __TAURI_INTERNALS__: {},
    };

    const html = renderToStaticMarkup(
      <CareerIntake
        onComplete={() => undefined}
        initialStep="source"
        initialSourceChoice="profile-import"
      />,
    );

    expect(html).toContain('career-platform-cards');
    expect(html).toContain('LinkedIn');
    expect(html).toContain('hh.ru');
    // The card explains where the sign-in happens, not how the connection is
    // measured: "динамическая проверка соединения" told the candidate nothing
    // they could act on (owner wording review, B157).
    expect(html).toContain('вход проходит на странице hh.ru, в вашей сессии');
    expect(html).not.toContain('динамической проверкой соединения');
    expect(html).toContain('Подключить');
  });

  it('renders all four source buttons proportionally on source step', () => {
    const html = renderToStaticMarkup(
      <CareerIntake
        onComplete={() => undefined}
        initialStep="source"
      />,
    );

    expect(html).toContain('Импорт профиля');
    expect(html).toContain('PDF');
    expect(html).toContain('Текстом');
    expect(html).toContain('Без документов');
  });
});
