import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

const source = readFileSync(join(__dirname, 'linkedin_form_capture.js'), 'utf8');

function capture(html: string): { out: string; dom: JSDOM; events: string[] } {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const events: string[] = [];
  for (const type of ['click', 'input', 'change', 'submit', 'keydown', 'focusin']) {
    dom.window.document.addEventListener(type, () => events.push(type), true);
  }
  const host = dom.window.document.querySelector('#host');
  if (host) {
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<textarea id="inner"></textarea><code>csrf-inner</code>';
  }
  return { out: dom.window.eval(source) as string, dom, events };
}

describe('захват формы LinkedIn', () => {
  it('отдаёт разметку со вложенным теневым деревом и без встроенных данных', () => {
    const { out } = capture(
      '<body><div id="host"></div><textarea id="about"></textarea><script>secret</script><code>csrf</code><input type="hidden" value="token"></body>',
    );
    expect(out).toContain('id="about"');
    expect(out).toContain('id="inner"');
    expect(out).not.toMatch(/secret|csrf|token/u);
  });

  it('ничего не меняет и не нажимает на странице', () => {
    const { dom, events } = capture(
      '<body><form><textarea>Текст</textarea><script>x</script><button>Save</button></form></body>',
    );
    expect(events).toEqual([]);
    expect(dom.window.document.body.innerHTML).toBe(
      '<form><textarea>Текст</textarea><script>x</script><button>Save</button></form>',
    );
  });
});
