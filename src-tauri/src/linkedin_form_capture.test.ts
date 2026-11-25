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

const stateSource = readFileSync(join(__dirname, 'linkedin_form_state.js'), 'utf8');

function state(html: string, wantsForm = true, status = 200): string {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.Element.prototype.getClientRects = function () {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  };
  Object.defineProperty(dom.window.performance, 'getEntriesByType', {
    value: () => [{ responseStatus: status }],
  });
  return dom.window.eval(stateSource.replaceAll('__WANTS_FORM__', String(wantsForm))) as string;
}

describe('страница формы LinkedIn', () => {
  const form = '<body><div role="dialog"><textarea></textarea></div></body>';

  it('принимает страницу с формой и профиль без неё', () => {
    expect(state(form)).toBe('ok');
    expect(state('<body><main>Profile</main></body>', false)).toBe('ok');
  });

  it('узнаёт блокировку запросов по ответу и по тексту', () => {
    expect(state(form, true, 999)).toBe('request_blocked');
    expect(state(form, true, 429)).toBe('request_blocked');
    expect(state('<title>LinkedIn: Request Denied</title><body></body>', false)).toBe(
      'request_blocked',
    );
    expect(state('<body><h1>Too many requests</h1></body>', false)).toBe('request_blocked');
  });

  it('не принимает страницу без видимой формы', () => {
    expect(state('<body><input type="text" aria-label="Search"></body>')).toBe('form_missing');
    expect(state('<body><form hidden><textarea></textarea></form></body>')).toBe('form_missing');
  });
});
