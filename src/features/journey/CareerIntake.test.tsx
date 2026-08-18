import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerIntake, IMPORT_ACTION_LABEL, PRESS_IMPORT_FIRST_MESSAGE } from './CareerIntake';

/**
 * B140 — the wizard must never send a candidate to a button that is not on the
 * screen in front of them. The reachable flow is asserted in the browser
 * (`e2e/workspace-defects.spec.ts`); here the two strings are pinned to one
 * source so a rename cannot split them again.
 */
describe('CareerIntake', () => {
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

  it('exports IMPORT_ACTION_LABEL correctly', () => {
    expect(IMPORT_ACTION_LABEL).toBe('Импортировать');
  });
});

