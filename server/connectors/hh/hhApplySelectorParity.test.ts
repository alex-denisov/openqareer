import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HH_SELECTORS } from './hhSelectors';

const REPOSITORY_ROOT = join(import.meta.dirname, '..', '..', '..');

/**
 * B704: отклик в окне сессии кандидата идёт в настольном приложении (Rust), а остальной
 * продукт знает те же поля hh.ru в TypeScript. Разошедшаяся копия молча ломает отклик —
 * этот тест держит обе копии одинаковыми.
 */
describe('hh.ru apply selectors are the same in the desktop app and the product', () => {
  const rust = readFileSync(join(REPOSITORY_ROOT, 'src-tauri', 'src', 'hh_apply.rs'), 'utf8');
  const constant = (name: string) =>
    new RegExp(`pub const ${name}: &str = r#"([\\s\\S]*?)"#;`, 'u').exec(rust)?.[1];

  it.each([
    ['HH_RESPONSE_BUTTON_TOP', HH_SELECTORS.vacancy.responseButtonTop],
    ['HH_RESPONSE_BUTTON_BOTTOM', HH_SELECTORS.vacancy.responseButtonBottom],
    ['HH_ALREADY_APPLIED', HH_SELECTORS.vacancy.alreadyAppliedBadge],
    ['HH_APPLY_POPUP', HH_SELECTORS.apply.popup],
    ['HH_RESUME_ITEM', HH_SELECTORS.apply.resumeRadio],
    ['HH_LETTER_TOGGLE', HH_SELECTORS.apply.letterToggle],
    ['HH_LETTER_TEXTAREA', HH_SELECTORS.apply.letterTextarea],
    ['HH_SUBMIT', HH_SELECTORS.apply.submitButton],
    ['HH_QUESTIONNAIRE', HH_SELECTORS.apply.questionnaireWarning],
    ['HH_SUCCESS', HH_SELECTORS.apply.success],
    ['HH_CAPTCHA', HH_SELECTORS.security.captchaContainer],
  ])('%s', (name, expected) => {
    expect(constant(name), `${name} must stay a raw string literal in hh_apply.rs`).toBe(expected);
  });
});
