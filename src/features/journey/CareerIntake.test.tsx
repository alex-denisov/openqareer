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

  it('selects option 1 "Импорт профиля" by default on step 2', () => {
    const html = renderToStaticMarkup(
      <CareerIntake
        onComplete={() => undefined}
        initialStarted
        initialStep="source"
      />,
    );

    // Assert that "Импорт профиля" is rendered and selected by default
    expect(html).toContain('Импорт профиля');
    expect(html).toContain('is-selected');
    // In web mode, shows web desktop CTA callout for profile import
    expect(html).toContain('Импорт профилей LinkedIn и hh.ru доступен в десктопном приложении');
    expect(html).toContain('Скачать OpenQareer Desktop');
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
    expect(html).toContain('Прямой импорт резюме hh.ru с динамической проверкой соединения');
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
