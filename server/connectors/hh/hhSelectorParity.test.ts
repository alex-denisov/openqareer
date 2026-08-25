import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HH_SELECTORS } from './hhSelectors';

const REPOSITORY_ROOT = join(import.meta.dirname, '..', '..', '..');

/**
 * The desktop app decides "the candidate is signed in" in Rust, and the rest of
 * the product decides it in TypeScript, from two copies of the same CSS
 * selector. If one copy drifts, the desktop connector silently stops
 * recognising a completed sign-in: the poller keeps returning
 * `waiting_for_sign_in`, nothing appears on screen, and no gate fails. That is
 * exactly the symptom the owner reported — "после авторизации ничего не
 * происходит" (B157).
 *
 * Until the two runtimes can share one constant, this test is the guard.
 */
describe('hh signed-in selector parity between Rust and TypeScript', () => {
  it('keeps the desktop and product definitions identical', () => {
    const rust = readFileSync(
      join(REPOSITORY_ROOT, 'src-tauri', 'src', 'connector_session.rs'),
      'utf8',
    );
    // The literal itself contains quotes, so it ends at the raw-string terminator.
    const declaration = /const HH_SIGNED_IN_SELECTOR: &str = r#"([\s\S]*?)"#;/u.exec(rust);

    expect(
      declaration,
      'HH_SIGNED_IN_SELECTOR must stay declared as a raw string literal in connector_session.rs',
    ).not.toBeNull();
    expect(declaration?.[1]).toBe(HH_SELECTORS.security.applicantProfile);
  });

  it('still covers every responsive variant of the applicant menu', () => {
    // Live hh.ru renders one of these at a time depending on viewport; losing a
    // variant means mobile or desktop sign-in stops being detected.
    for (const marker of [
      'mainmenu_applicantProfile',
      'mainmenu_profileAndResumes',
      'profile-activator',
    ]) {
      expect(HH_SELECTORS.security.applicantProfile).toContain(marker);
    }
  });

  /**
   * The recogniser itself is one shipped file. If a future change inlines a
   * copy back into Rust, the live evidence gate would keep exercising the file
   * while the desktop ran something else — the exact split this guard exists to
   * prevent (B157).
   */
  it('keeps the desktop recogniser loaded from the one shipped script', () => {
    const rust = readFileSync(
      join(REPOSITORY_ROOT, 'src-tauri', 'src', 'connector_session.rs'),
      'utf8',
    );

    expect(rust).toContain('include_str!("connector_inspection.js")');
    expect(rust).not.toContain('signedInApplicant:');
  });
});
