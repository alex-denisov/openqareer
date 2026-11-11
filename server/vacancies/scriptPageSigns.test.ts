import { describe, expect, it } from 'vitest';
import { hasScriptPageSigns } from './scriptPageSigns';

const longText = 'Мы строим продукт для логистики и ищем людей в команду. '.repeat(40);

describe('hasScriptPageSigns (B643)', () => {
  it('пустая оболочка SPA с div#root', () => {
    const html =
      '<html><head><title>Careers</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
    expect(hasScriptPageSigns(html)).toBe(true);
  });

  it('оболочка с div#app и div#__nuxt', () => {
    expect(hasScriptPageSigns('<body><div id="app"></div></body>')).toBe(true);
    expect(hasScriptPageSigns("<body><div id='__nuxt'><!----></div></body>")).toBe(true);
  });

  it('состояние Nuxt и window.__INITIAL_STATE__ даже при длинном тексте', () => {
    expect(
      hasScriptPageSigns(`<body><p>${longText}</p><script>window.__NUXT__={}</script></body>`),
    ).toBe(true);
    expect(
      hasScriptPageSigns(
        `<body><p>${longText}</p><script>window.__INITIAL_STATE__ = {"jobs":[]}</script></body>`,
      ),
    ).toBe(true);
  });

  it('ссылка «Вакансии» с href="#"', () => {
    expect(
      hasScriptPageSigns(`<body><p>${longText}</p><a href="#" class="nav">Вакансии</a></body>`),
    ).toBe(true);
    expect(
      hasScriptPageSigns(`<body><p>${longText}</p><a class="x" href='#'>Open positions</a></body>`),
    ).toBe(true);
  });

  it('обычная страница с текстом и div#root не считается оболочкой', () => {
    expect(
      hasScriptPageSigns(`<body><div id="root"><main><p>${longText}</p></main></div></body>`),
    ).toBe(false);
  });

  it('статическая страница без признаков', () => {
    expect(
      hasScriptPageSigns(
        `<body><h1>О компании</h1><p>${longText}</p><a href="/about">О нас</a></body>`,
      ),
    ).toBe(false);
    expect(hasScriptPageSigns('')).toBe(false);
  });

  it('текст внутри script и style не считается видимым', () => {
    const html = `<body><div id="root"></div><script>var t="${longText}"</script><style>.a{}</style></body>`;
    expect(hasScriptPageSigns(html)).toBe(true);
  });

  it('ссылка с href="#" без слова о вакансиях не считается признаком', () => {
    expect(hasScriptPageSigns(`<body><p>${longText}</p><a href="#">Наверх</a></body>`)).toBe(false);
  });
});
