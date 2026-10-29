/**
 * B569 SEO-04: one 1200x630 share image per public page.
 * Run: node scripts/og-images.mjs  (writes public/og/<name>.png, commit them).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const ROOT = new URL('../', import.meta.url);
const WIDTH = 1200;
const HEIGHT = 630;

/** name, headline (plain + accent line), caption from the page description. */
export const OG_PAGES = [
  {
    name: 'home',
    plain: 'Вы выбираете работу.',
    accent: 'Резюме, поиск и отклики — на нас',
    size: 58,
    caption:
      'ИИ соберёт сильное резюме из вашего опыта, найдёт свежие вакансии и откликнется по вашим правилам.',
  },
  {
    name: 'faq',
    plain: 'Вопросы о поиске работы:',
    accent: 'резюме, отклик, оффер',
    caption:
      'Ответы на 48 вопросов: кем я могу работать, что писать в отклике, как найти работу без опыта и за границей.',
  },
  {
    name: 'tariffs',
    plain: 'Тарифы openqareer:',
    accent: 'начните бесплатно',
    caption:
      'Basic 3 990 ₽ — резюме под каждую вакансию, Pro 9 900 ₽ — отклики за вас, Max 39 900 ₽ — сильнейшая модель консультанта.',
  },
  {
    name: 'salary-calculator',
    plain: 'Зарплата после налогов',
    accent: 'в 13 странах',
    caption: 'Чистый доход за 2026 год со своими расходами. Без регистрации.',
  },
  {
    name: 'resume',
    plain: 'Конструктор резюме онлайн',
    accent: 'с проверкой на ATS',
    caption:
      'Заполните резюме по шагам, к каждому полю есть подсказка. Готовое резюме скачайте в PDF или DOCX.',
  },
  {
    name: 'interview-questions',
    plain: 'Вопросы на собеседовании',
    accent: 'с разбором ответов',
    caption:
      'По профессиям, сверено с требованиями реальных вакансий. В конце — тест на 5 вопросов без регистрации.',
  },
  {
    name: 'relocation',
    plain: 'В какую страну вы можете',
    accent: 'переехать работать',
    caption: 'Официальные правила 2026 года, у каждой цифры — источник.',
  },
  {
    name: 'salaries',
    plain: 'Зарплаты и навыки',
    accent: 'по профессиям',
    caption: 'Вилки и навыки из каталога вакансий: валюта, период, размер и дата выборки.',
  },
  {
    name: 'vacancies',
    plain: 'Свежие вакансии',
    accent: 'в одном списке',
    caption:
      'Из разных источников: зарплата, город, формат работы и дата публикации у каждой вакансии.',
  },
];

async function fontFace(weight) {
  const file = new URL(
    `node_modules/@fontsource/onest/files/onest-cyrillic-${weight}-normal.woff2`,
    ROOT,
  );
  const latin = new URL(
    `node_modules/@fontsource/onest/files/onest-latin-${weight}-normal.woff2`,
    ROOT,
  );
  const face = async (url) =>
    `@font-face{font-family:Onest;font-weight:${weight};src:url(data:font/woff2;base64,${(await readFile(url)).toString('base64')}) format('woff2')}`;
  return `${await face(file)}${await face(latin)}`;
}

function template(page, fonts, mark) {
  return `<!doctype html><meta charset="utf-8"><style>${fonts}
*{box-sizing:border-box;margin:0}
body{width:${WIDTH}px;height:${HEIGHT}px;background:#f8fafc;font-family:Onest,sans-serif;padding:80px;position:relative;color:#111827}
.brand{display:flex;align-items:center;gap:14px;font-weight:700;font-size:36px;letter-spacing:-.01em}
.brand svg{width:48px;height:48px}.brand b{color:#0a62d6}
h1{margin-top:64px;font-size:76px;line-height:1.1;font-weight:700;letter-spacing:-.025em}
h1 span{display:block;color:#0a62d6}
p{margin-top:36px;max-width:960px;font-size:30px;line-height:1.45;font-weight:400;color:#4b5563}
.url{position:absolute;right:80px;bottom:56px;font-size:26px;font-weight:600;color:#4b5563}
</style><div class="brand">${mark}<div>open<b>q</b>areer</div></div>
<h1 style="font-size:${page.size ?? 76}px">${page.plain}<span>${page.accent}</span></h1><p>${page.caption}</p>
<div class="url">openqareer.com</div>`;
}

const mark = (await readFile(new URL('public/favicon.svg', ROOT), 'utf8')).replace(
  /<title>.*?<\/title>/su,
  '',
);
const fonts = `${await fontFace(600)}${await fontFace(400)}${await fontFace(700).catch(() => '')}`;
await mkdir(new URL('public/og/', ROOT), { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const tab = await context.newPage();
for (const page of OG_PAGES) {
  await tab.setContent(template(page, fonts, mark));
  await tab.evaluate(() => document.fonts.ready);
  const png = await tab.screenshot({ type: 'png' });
  await writeFile(new URL(`public/og/${page.name}.png`, ROOT), png);
}
await browser.close();
