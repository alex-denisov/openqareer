// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, 'contact_overlay_ready.js'), 'utf8');
const fixture = (name: string) =>
  readFileSync(
    join(__dirname, '../../src/features/connections/__fixtures__/linkedin', name),
    'utf8',
  );
/** The shell evaluates the file as it is and reads a JSON boolean back (connector_session.rs). */
const ready = (html: string): unknown => {
  document.body.innerHTML = html;
  return (0, eval)(source) as unknown;
};

describe('contact-info overlay readiness (B561)', () => {
  it('is ready once the dialog carries the profile row (live overlay)', () => {
    expect(ready(fixture('contact-info-live.html'))).toBe(true);
  });

  it('is ready on the Russian section/h3 overlay shape', () => {
    expect(ready(fixture('contact-info-ru-sanitized.html'))).toBe(true);
  });

  it('is ready when the profile link is absolute, as before the sanitizer', () => {
    expect(ready(fixture('contact-info.html'))).toBe(true);
  });

  it('is not ready while only the profile behind the overlay has rendered', () => {
    // The 30.10 import: the profile page was captured before the dialog opened.
    expect(ready(`<main>${fixture('profile.html')}</main>`)).toBe(false);
  });

  it('is not ready while the dialog holds only its header', () => {
    expect(
      ready(
        '<dialog><header><h2>Contact info</h2></header><div data-testid="dialog-content"></div></dialog>',
      ),
    ).toBe(false);
  });

  it('ignores the edit-form link, which is not the profile row', () => {
    expect(
      ready(
        '<div role="dialog"><a href="/in/ivan-testov-test/edit/forms/contact-info/new/">Edit</a></div>',
      ),
    ).toBe(false);
  });
});
