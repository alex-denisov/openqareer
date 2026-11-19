import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const SIGNED = '[data-qa^="mainmenu_applicantProfile"]';
const source = readFileSync(join(__dirname, 'hh_raise_page.js'), 'utf8').replaceAll(
  '__SIGNED_IN_SELECTOR__',
  JSON.stringify(SIGNED),
);

const menu = '<div data-qa="mainmenu_applicantProfile"></div>';
const raiseButton = '<button data-qa="resume-update-button">Поднять в поиске</button>';

function open(html: string, url = 'https://hh.ru/resume/abc123') {
  const dom = new JSDOM(`<body>${html}</body>`, { url, runScripts: 'outside-only' });
  const { window } = dom;
  // jsdom has no layout: an element counts as shown unless it sits under [hidden].
  window.Element.prototype.getClientRects = function (this: Element) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  };
  const clicks: string[] = [];
  window.document.addEventListener('click', (event) => {
    clicks.push((event.target as Element).getAttribute('data-qa') ?? 'click');
  }, true);
  const run = () => (window.eval(source) as { code: string }).code;
  return { run, clicks, window };
}

describe('B699: страница поднятия резюме hh.ru', () => {
  it('нажимает «Поднять в поиске» один раз и подтверждает по обратному отсчёту', () => {
    const page = open(menu + raiseButton);
    expect(page.run()).toBe('waiting');
    expect(page.run()).toBe('waiting');
    expect(page.clicks).toEqual(['resume-update-button']);
    page.window.document.body.insertAdjacentHTML('beforeend', '<p>Поднять можно через 3 часа 59 минут</p>');
    expect(page.run()).toBe('ok');
    expect(page.clicks).toHaveLength(1);
  });

  it('находит кнопку по тексту, а не по data-qa', () => {
    const page = open(`${menu}<button>Поднять в поиске</button>`);
    page.run();
    expect(page.clicks).toHaveLength(1);
  });

  it('«можно будет поднять через…» — слишком рано, без нажатия', () => {
    const page = open(`${menu}<p>Поднять в поиске можно будет поднять через 2 часа</p>`);
    expect(page.run()).toBe('too_early');
    expect(page.clicks).toHaveLength(0);
  });

  it('кнопка недоступна — слишком рано', () => {
    const page = open(`${menu}<button disabled>Поднять в поиске</button>`);
    expect(page.run()).toBe('too_early');
    expect(page.clicks).toHaveLength(0);
  });

  it('капча важнее всего остального', () => {
    expect(open(`${menu}<div data-qa="captcha"></div>${raiseButton}`).run()).toBe('captcha');
  });

  it('форма входа или нет профиля — «войдите заново»', () => {
    expect(open('<form><input type="password"></form>', 'https://hh.ru/account/login').run()).toBe('logged_out');
    expect(open(raiseButton).run()).toBe('logged_out');
  });

  it('чужой домен — foreign_page', () => {
    expect(open(menu + raiseButton, 'https://evil.example/resume/abc123').run()).toBe('foreign_page');
    expect(open(menu + raiseButton, 'https://hh.ru.evil.example/resume/abc123').run()).toBe('foreign_page');
  });

  it('не страница резюме — error; страница ещё рисуется — waiting', () => {
    expect(open(menu, 'https://hh.ru/vacancy/1').run()).toBe('error');
    const page = open(menu);
    expect(page.run()).toBe('waiting');
    expect(page.clicks).toHaveLength(0);
  });

  it('метка нажатия от другого резюме не считается', () => {
    const page = open(menu + raiseButton);
    page.window.sessionStorage.setItem('__oqHhRaise', `/resume/other|${Date.now()}`);
    page.run();
    expect(page.clicks).toHaveLength(1);
  });
});
