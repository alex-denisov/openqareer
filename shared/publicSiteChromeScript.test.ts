// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { catalogChromeHeader } from '../server/vacancies/catalogChrome';

const SCRIPT = readFileSync(join(process.cwd(), 'public/assets/oq-chrome-2.js'), 'utf8');

function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('B574: oq-chrome-2.js on server-rendered pages', () => {
  beforeEach(() => {
    document.body.innerHTML = catalogChromeHeader();
    new Function(SCRIPT)();
  });

  it('opens the tools list on click and closes it with Escape, focus back on the trigger', () => {
    const trigger = document.querySelector<HTMLAnchorElement>(
      '.ps-tooldrop.is-nav .ps-tooldrop-trigger',
    )!;
    const panel = document.getElementById('ps-tooldrop-menu')!;
    expect(trigger.getAttribute('role')).toBe('button');
    expect(panel.hidden).toBe(true);
    trigger.click();
    expect(panel.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panel.querySelectorAll('a')).toHaveLength(6);
    press('Escape');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the list on a click outside and opens it with Space', () => {
    const trigger = document.querySelector<HTMLAnchorElement>(
      '.ps-tooldrop.is-nav .ps-tooldrop-trigger',
    )!;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(document.getElementById('ps-tooldrop-menu')!.hidden).toBe(false);
    document.body.click();
    expect(document.getElementById('ps-tooldrop-menu')!.hidden).toBe(true);
  });

  it('gives the phone menu its own copy of the sections with a tools group', () => {
    const menu = document.getElementById('ps-menu')!;
    const group = menu.querySelector('.ps-tooldrop.is-menu .ps-tooldrop-trigger') as HTMLAnchorElement;
    expect(group.getAttribute('aria-controls')).toBe('ps-menu-tools');
    expect(menu.querySelector('a[href="/tariffs"]')).not.toBeNull();
    group.click();
    expect(document.getElementById('ps-menu-tools')!.hidden).toBe(false);
  });
});
