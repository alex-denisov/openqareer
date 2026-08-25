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

  it('opens on the start screen without a wizard step behind it', () => {
    const html = renderToStaticMarkup(<CareerIntake onComplete={() => undefined} />);

    expect(html).toContain('Начните с карьерного вопроса');
    expect(html).toContain('Начать диагностику');
    expect(html).not.toContain('С чем разобраться?');
  });

  it('asks for the import action by the name the button actually carries', () => {
    expect(PRESS_IMPORT_FIRST_MESSAGE).toContain(`«${IMPORT_ACTION_LABEL}»`);
    expect(PRESS_IMPORT_FIRST_MESSAGE).not.toContain('Импортировать по ссылке');
  });

  it('renders start screen note explaining documents are optional', () => {
    const html = renderToStaticMarkup(<CareerIntake onComplete={() => undefined} />);

    expect(html).toContain('Можно начать без документов');
    expect(html).toContain('Без аккаунта прогресс хранится только в текущей вкладке.');
  });

  it('selects PDF by default on the web source step', () => {
    const html = renderToStaticMarkup(
      <CareerIntake
        onComplete={() => undefined}
        initialStarted
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
        initialStarted
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
        initialStarted
        initialStep="source"
      />,
    );

    expect(html).toContain('Импорт профиля');
    expect(html).toContain('PDF');
    expect(html).toContain('Текстом');
    expect(html).toContain('Без документов');
  });
});
