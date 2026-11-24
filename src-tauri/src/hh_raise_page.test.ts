import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const SIGNED = '[data-qa^="mainmenu_applicantProfile"]';
const file = readFileSync(join(__dirname, 'hh_raise_page.js'), 'utf8');
const ID = 'abc123';
const script = (list: boolean, mayPress: boolean) =>
  file
    .replaceAll('__SIGNED_IN_SELECTOR__', JSON.stringify(SIGNED))
    .replaceAll('__RESUME_ID__', JSON.stringify(ID))
    .replaceAll('__LIST_MODE__', String(list))
    .replaceAll('__MAY_PRESS__', String(mayPress));

const menu = '<div data-qa="mainmenu_applicantProfile"></div>';
const raiseButton = '<button data-qa="resume-update-button">Поднять в поиске</button>';

function open(
  html: string,
  url = 'https://hh.ru/resume/abc123',
  { list = false, mayPress = true } = {},
) {
  const dom = new JSDOM(`<body>${html}</body>`, { url, runScripts: 'outside-only' });
  const { window } = dom;
  // jsdom has no layout: an element counts as shown unless it sits under [hidden].
  window.Element.prototype.getClientRects = function (this: Element) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  };
  const clicks: string[] = [];
  window.document.addEventListener(
    'click',
    (event) => {
      clicks.push((event.target as Element).getAttribute('data-qa') ?? 'click');
    },
    true,
  );
  Object.defineProperty(window.document, 'readyState', { value: 'complete' });
  const step = () =>
    window.eval(script(list, mayPress)) as { code: string; pressed?: boolean; card?: boolean };
  const run = () => step().code;
  return { run, step, clicks, window };
}

describe('B699: страница поднятия резюме hh.ru', () => {
  it('нажимает «Поднять в поиске» один раз и подтверждает по обратному отсчёту', () => {
    const page = open(menu + raiseButton);
    expect(page.run()).toBe('waiting');
    expect(page.run()).toBe('waiting');
    expect(page.clicks).toEqual(['resume-update-button']);
    page.window.document.body.insertAdjacentHTML(
      'beforeend',
      '<p>Поднять можно через 3 часа 59 минут</p>',
    );
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
    expect(open('<form><input type="password"></form>', 'https://hh.ru/account/login').run()).toBe(
      'logged_out',
    );
    expect(open(raiseButton).run()).toBe('logged_out');
  });

  it('чужой домен — foreign_page', () => {
    expect(open(menu + raiseButton, 'https://evil.example/resume/abc123').run()).toBe(
      'foreign_page',
    );
    expect(open(menu + raiseButton, 'https://hh.ru.evil.example/resume/abc123').run()).toBe(
      'foreign_page',
    );
  });

  it('не страница резюме — error; страница ещё рисуется — waiting', () => {
    expect(open(menu, 'https://hh.ru/vacancy/1').run()).toBe('error');
    const page = open(menu);
    expect(page.run()).toBe('waiting');
    expect(page.clicks).toHaveLength(0);
  });

  it('метка нажатия от другого резюме не считается', () => {
    const page = open(menu + raiseButton);
    page.window.sessionStorage.setItem('__oqHhRaise', `other|${Date.now()}|resume`);
    page.run();
    expect(page.clicks).toHaveLength(1);
  });

  it.each(['Поднять в 20:55', 'Поднять завтра в 9:05', '<b>Поднять в</b> <i>20:55</i>'])(
    '«%s» до нажатия — слишком рано, даже далеко в тексте и при кнопке',
    (label) => {
      const page = open(
        `${menu}<p>${'опыт '.repeat(2000)}</p><button><span>${label}</span></button>${raiseButton}`,
      );
      const available = label.includes('9:05') ? '09:05' : '20:55';
      expect(page.step()).toEqual({ code: 'too_early', available });
      expect(page.clicks).toHaveLength(0);
    },
  );

  it('после нажатия «Поднять в ЧЧ:ММ» — ok', () => {
    const page = open(menu + raiseButton);
    page.run();
    page.window.document.body.insertAdjacentHTML('beforeend', '<span>Поднять в 20:55</span>');
    expect(page.run()).toBe('ok');
  });

  it('текст резюме и скрытый элемент не считаются признаком', () => {
    const page = open(
      `${menu}${raiseButton}<p>Поднять продажи в 10:00</p><p>Умею поднять в 10:00 весь отдел</p>` +
        '<p>Резюме обновлено 1 ноября в 10:00</p><p hidden>Поднять в 20:55</p>',
    );
    expect(page.run()).toBe('waiting');
    expect(page.clicks).toHaveLength(1);
    expect(page.run()).toBe('waiting');
  });

  it('кнопка исчезла после нажатия на два опроса подряд — ok', () => {
    const page = open(`${menu}<h2>Инженер</h2>${raiseButton}`);
    const button = page.window.document.querySelector('button');
    page.run();
    button?.remove();
    expect(page.run()).toBe('waiting');
    page.window.document.body.append(button as Element);
    expect(page.run()).toBe('waiting');
    button?.remove();
    expect(page.run()).toBe('waiting');
    expect(page.run()).toBe('ok');
    expect(page.clicks).toHaveLength(1);
  });

  it('страница не отрисована — исчезновение кнопки не считается', () => {
    const page = open(menu + raiseButton);
    page.run();
    page.window.document.querySelector('button')?.remove();
    for (let i = 0; i < 4; i += 1)
      expect(page.step()).toMatchObject({ code: 'waiting', pressed: true });
  });
});

describe('B699: список резюме hh.ru', () => {
  const PROFILE = 'https://hh.ru/applicant/profile/me';
  const card = (id: string, control: string) =>
    `<div data-qa="resume"><a data-qa="resume-card-link-${id}" href="/resume/${id}?hhtmFrom=resume_list"><h3>Инженер</h3></a>${control}</div>`;
  const raiseLink = (id: string) => `<a data-qa="raise-${id}" href="#">Поднять в поиске</a>`;
  const list = (html: string, mayPress = true, url = PROFILE) =>
    open(menu + html, url, { list: true, mayPress });

  it('нажимает ссылку только в карточке этого резюме и один раз', () => {
    const page = list(card('def456', raiseLink('def456')) + card(ID, raiseLink(ID)));
    expect(page.step()).toMatchObject({ code: 'waiting', pressed: true });
    expect(page.run()).toBe('waiting');
    expect(page.clicks).toEqual([`raise-${ID}`]);
    page.window.document.querySelector(`[data-qa="raise-${ID}"]`)?.replaceWith('Поднять в 20:55');
    page.run();
    expect(page.run()).toBe('ok');
  });

  it('признак из чужой карточки не считается, из своей — слишком рано', () => {
    const own = list(
      card('def456', raiseLink('def456')) + card(ID, '<span>Поднять в 20:55</span>'),
    );
    expect(own.step()).toEqual({ code: 'too_early', available: '20:55' });
    expect(own.clicks).toHaveLength(0);
    const other = list(
      card('def456', '<span>Поднять в 20:55</span>') + card(ID, raiseLink(ID)),
      false,
    );
    expect(other.run()).toBe('waiting');
    expect(other.run()).toBe('waiting');
    expect(other.clicks).toHaveLength(0);
  });

  it('уже нажали на странице резюме — только подтверждает', () => {
    const page = list(
      card(ID, '<span>Поднять в 20:55</span>'),
      false,
      'https://hh.ru/applicant/resumes',
    );
    expect(page.run()).toBe('ok');
    const marked = list(card(ID, raiseLink(ID)));
    marked.window.sessionStorage.setItem('__oqHhRaise', `${ID}|${Date.now()}|resume`);
    marked.run();
    expect(marked.clicks).toHaveLength(0);
    marked.window.document.querySelector(`[data-qa="raise-${ID}"]`)?.remove();
    for (let i = 0; i < 4; i += 1) expect(marked.run()).toBe('waiting');
  });

  it('связь карточки с резюме не доказана — не нажимает', () => {
    const mixed = `<div data-qa="resume"><a href="/resume/${ID}">А</a><a href="/resume/def456">Б</a>${raiseLink('x')}</div>`;
    for (const html of [
      card('def456', raiseLink('x')),
      mixed,
      `<a href="/resume/${ID}">А</a>${raiseLink('x')}`,
    ]) {
      const page = list(html);
      expect(page.step()).toMatchObject({ code: 'waiting', card: false });
      expect(page.clicks).toHaveLength(0);
    }
  });

  it('страница резюме ещё открыта — ждёт и не нажимает; чужой раздел — error', () => {
    const page = list(raiseButton, true, 'https://hh.ru/resume/abc123');
    expect(page.run()).toBe('waiting');
    expect(page.clicks).toHaveLength(0);
    expect(list(raiseButton, true, 'https://hh.ru/vacancy/1').run()).toBe('error');
  });
});
