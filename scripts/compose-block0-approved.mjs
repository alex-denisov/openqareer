import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('output/block-0');
const mock = path.join(
  process.env.BLOCK0_MOCKUPS ?? path.resolve('docs/v1-release/tasks/work/B430-mockups'),
  'screens',
);
const browser = await chromium.launch();
const references = path.join(root, 'reference-complete');
await fs.mkdir(references, { recursive: true });
const definitions = [
  ['goal-long', 'Цель — длинный текст', '0-vhod-i-pervyj-zapusk', '?frame&view=step1l'],

  ['goal', 'Первый запуск — цель', '0-vhod-i-pervyj-zapusk', '?frame&view=step1'],
  ['source', 'Первый запуск — источник', '0-vhod-i-pervyj-zapusk', '?frame&view=intake'],
  ['context', 'Первый запуск — контекст', '0-vhod-i-pervyj-zapusk', '?frame&view=step3'],
  [
    'skip-confirm',
    'Подтверждение пропуска источника',
    '0-vhod-i-pervyj-zapusk',
    '?frame&view=skip',
  ],
  ['city-picker', 'Выбор города', '0-vhod-i-pervyj-zapusk', '?frame&view=city'],
  ['session-loading', 'Загрузка оболочки', '0-vhod-i-pervyj-zapusk', '?frame&view=skeleton'],
  [
    'consultant-open',
    'Сегодня — открытый консультант / мобильный лист',
    '1-segodnya',
    '?frame&sheet=open',
  ],
  ['consultant-strip', 'Сегодня — консультант свёрнут', '1-segodnya', '?frame&panel=collapsed'],
  ['history', 'История бесед', '1-segodnya', '?frame&panel=history&sheet=open'],
  ['history-detail', 'Открытая беседа', null, null],
  ['history-error', 'Ошибка истории', null, null],
  ['history-empty', 'Пустая история', null, null],
  ['more-menu', 'Меню «Ещё»', '1-segodnya', '?frame&more=open'],
  ['login', 'Форма входа', null, null],
];
for (const width of [1440, 390, 1280, 1176, 1024, 900]) {
  const p = await browser.newPage({
    viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: 'reduce',
  });
  await p.route('**/*', async (r) => {
    if (r.request().isNavigationRequest() && r.request().frame() !== p.mainFrame())
      return r.abort();
    await r.continue();
  });
  for (const [id, , file, query] of definitions) {
    if (!file) continue;
    if (
      await fs.access(path.join(references, `${id}-${width}.png`)).then(
        () => true,
        () => false,
      )
    )
      continue;
    if (width !== 390 && ['skip-confirm', 'city-picker', 'more-menu', 'goal-long'].includes(id))
      continue;
    console.log('reference', width, id);
    await p.goto(`file://${path.join(mock, file + '.html')}${query}`, {
      waitUntil: 'domcontentloaded',
    });
    await p.evaluate(() => document.fonts.ready);
    if (width === 390)
      await p.addStyleTag({
        content:
          ':root{--safe-t:0px;--safe-b:0px}html.is-frame body::before,html.is-frame body::after{display:none}',
      });
    await p.screenshot({
      path: path.join(references, `${id}-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await p.close();
}
const exists = async (f) =>
  fs.access(f).then(
    () => true,
    () => false,
  );
const manifest = [];
function esc(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}
async function fig(label, file, note = '') {
  if (!file || !(await exists(file)))
    return `<figure><figcaption>${label}</figcaption><p class="missing">${note || 'Отдельного кадра нет.'}</p></figure>`;
  if (/^(Кадр ещё не снят|Отдельный кадр не снят|Native-кадр|НЕ ВОСПРОИЗВОДИТСЯ)/.test(note))
    note = '';
  const rel = path.relative(root, file);
  return `<figure><figcaption>${label}</figcaption>${note ? `<p>${note}</p>` : ''}<a href="${rel}" target="_blank"><img loading="lazy" src="${rel}" alt="${esc(label)}"></a></figure>`;
}
async function select(folder, id, width) {
  if (id === 'context') id = 'context-filled';
  if (id === 'city-picker') id = 'city-picker-selected';
  const f = path.join(root, folder, `${id}-full-${width}.png`);
  return (await exists(f)) ? f : path.join(root, folder, `${id}-${width}.png`);
}
const sections = [];
for (const width of [1440, 390]) {
  const surface = width === 1440 ? 'web' : 'mobile';
  let html = `<div id="${surface}" class="surface"><h2>${width === 1440 ? 'Веб · 1440' : 'Мобильная версия · 390'}</h2>`;
  for (const [id, title, file] of definitions) {
    if (width === 1440 && ['more-menu', 'skip-confirm', 'goal-long'].includes(id)) continue;
    const after = await select('after-complete', id, width);
    const reference = path.join(references, `${id}-${width}.png`);
    const missing = 'Кадр ещё не снят.';
    let refNote = !file
      ? 'В утверждённом перечне нет отдельного кадра этого состояния.'
      : width === 1440 && ['goal', 'context', 'skip-confirm', 'city-picker'].includes(id)
        ? 'Вспомогательный HTML. В утверждённом 1440-перечне экрана 0 — источник и скелет.'
        : '';
    const cells = await Promise.all([
      fig('Эталон / вспомогательный HTML', reference, refNote),
      fig('Стало · текущая сборка', after, missing),
    ]);
    html += `<section id="${surface}-${id}"><h3>${title} · ${width}</h3><div class="comparison">${cells.join('')}</div>`;
    const bottom = path.join(root, 'after-complete', `${id}-bottom-${width}.png`);
    if (await exists(bottom))
      html += `<details><summary>Отдельно: нижний экран после прокрутки</summary>${await fig('Низ · фактический viewport', bottom)}</details>`;
    html += '</section>';
    manifest.push({
      surface,
      width,
      id,
      title,
      reference: (await exists(reference)) ? path.relative(root, reference) : null,
      after: (await exists(after)) ? path.relative(root, after) : null,
      openIssue: !(await exists(after)),
    });
  }
  html += '</div>';
  sections.push(html);
}
await fs.mkdir(path.join(root, 'extras'), { recursive: true });
let extra =
  '<div id="states" class="surface"><h2>Функциональные состояния</h2><p>Для них нет отдельного утверждённого кадра. Показаны фактические состояния локальной реализации с синтетическими данными.</p>';
for (const width of [1440, 390])
  for (const id of [
    'consultant-proposal-error',
    'decision-accepted',
    'decision-dismissed',
    'docx-read',
  ]) {
    const f = path.join(root, 'extras', `${id}-${width}.png`);
    await fs.copyFile(path.resolve('test-results/evidence/BLOCK-0', `${id}-${width}.png`), f);
    extra += `<section id="state-${id}-${width}"><h3>${id} · ${width}</h3>${await fig('Стало', f)}</section>`;
  }
for (const id of ['loading', 'error', 'empty-queue-no-decision']) {
  const f = path.join(root, 'extras', `today-${id}-390.png`);
  if (await exists(path.resolve('test-results/evidence/ACC-A-1', `390-${id}.png`)))
    await fs.copyFile(path.resolve('test-results/evidence/ACC-A-1', `390-${id}.png`), f);
  extra += `<section><h3>Сегодня · ${id} · 390</h3>${await fig('Стало · дополнительный сценарий', f)}</section>`;
}
sections.push(extra + '</div>');
let native =
  '<div id="native" class="surface"><h2>Десктопная .app · реальное окно WebKit</h2><p>Это native-снимки отдельной локальной .app. Данные визуального стенда синтетические, провайдеры отключены. Сохранение профиля через реальный API проверялось отдельно в предыдущем отчёте. Высота окна ограничена macOS: 806–807 px с заголовком.</p>';
for (const width of [1440, 1280, 1176, 1024, 900]) {
  native += `<section id="native-${width}"><h3>.app · ${width}</h3>`;
  for (const [id, title] of definitions.filter((d) =>
    [
      'source',
      'goal',
      'context',
      'session-loading',
      'consultant-open',
      'consultant-strip',
      'history',
      'login',
    ].includes(d[0]),
  )) {
    let actual = path.join(root, 'native-complete', `${id}-${width}.png`);
    if (!(await exists(actual)) && id === 'source')
      actual = path.join(root, 'native', `final-source-${width}.png`);
    native += `<details ${id === 'source' ? 'open' : ''}><summary>${title}</summary><div class="native-pair">${await fig('Макет · та же ширина', path.join(references, `${id}-${width}.png`))}${await fig('Стало · native', actual, 'Native-кадр этого состояния пока не снят.')}</div>`;
    for (let i = 1; i < 4; i++) {
      const scroll = path.join(root, 'native-complete', `${id}-scroll-${i}-${width}.png`);
      if (await exists(scroll))
        native += `<details><summary>Прокрутка ${i} — включая конец</summary>${await fig('Native · продолжение', scroll)}</details>`;
    }
    native += '</details>';
    manifest.push({
      surface: 'native',
      width,
      id,
      after: (await exists(actual)) ? path.relative(root, actual) : null,
      before: null,
    });
  }
  native +=
    '<details><summary>«Сегодня» целиком — последовательность перекрывающихся экранов до конца</summary><div class="scroll-sequence">';
  for (let i = 0; i < 6; i++)
    native += await fig(
      `Прокрутка ${i}/5`,
      path.join(root, 'native-complete', `today-scroll-${i}-${width}.png`),
    );
  native += '</div></details></section>';
}
native += '</div>';
sections.push(native);
const page = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Блок 0 · полный съём и открытые расхождения</title><style>html{color-scheme:dark;scroll-behavior:smooth}body{margin:0;padding:24px;font:16px/1.5 system-ui;background:#080d12;color:#edf1f7}nav{position:sticky;top:0;z-index:2;display:flex;gap:20px;flex-wrap:wrap;padding:14px;background:#111a24;border:1px solid #33404c}a{color:#7dbbff}h1,h2,h3{font-weight:600}p{max-width:110ch}.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.native-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}figure{margin:0}figcaption{padding:8px 0;font-weight:600}figure p{font-size:13px;color:#afbac8}img{display:block;max-width:100%;height:auto}section{margin:36px 0;padding-top:16px;border-top:1px solid #33404c;scroll-margin-top:80px}.surface{margin-top:50px;scroll-margin-top:80px}details{padding:12px;margin:12px 0;border:1px solid #33404c;border-radius:8px}summary{cursor:pointer}.missing{padding:20px;border:1px dashed #e4ad65;color:#e4ad65}.notice{padding:20px;border:1px solid #e4ad65;border-radius:10px}.scroll-sequence{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}</style><h1>Блок 0 — все представленные поверхности и состояния</h1><nav><a href="#web">Веб 1440</a><a href="#mobile">Мобильная 390</a><a href="#native">Десктопная .app</a><a href="#states">Ошибки, принятие/отказ, DOCX</a><a href="REPORT.md">Отчёт</a><button onclick="document.querySelectorAll('details').forEach(d=>d.open=true)">Раскрыть все состояния</button></nav><div class="notice"><b>Макет — текущая реализация. Без выкладки.</b><p>Карточки всех шагов на десктопе, отдельные мобильные шаги, выбор города, очередь, воронка и история доработаны. Автоматические проверки и замеры приведены в отчёте; окончательное визуальное совпадение подтверждает владелец.</p></div><p>Показаны только утверждённый макет и текущая реализация. Промежуточная версия приложения исключена. Реализация снята на локальных синтетических данных, без внешних провайдеров. Названия, количество задач и показатели могут отличаться от демонстрационных данных макета; неизвестные значения не заменены придуманными числами. Содержимое основной колонки снято прокруткой и склеено без изменения CSS; ниже каждого такого кадра доступен отдельный конечный viewport. У .app — реальные перекрывающиеся кадры прокрутки. Полосы iOS, нарисованные внутри макета, убраны для сравнения веб-контента; оригиналы доступны в reference/.</p><p>Нажмите на изображение для полного размера. Отсутствующие эталоны/состояния обозначены явно. Статические снимки не означают успешное выполнение внешних действий.</p>${sections.join('')}</html>`;
await fs.writeFile(path.join(root, 'review.html'), page);
await fs.writeFile(path.join(root, 'gallery-manifest.json'), JSON.stringify(manifest, null, 2));
const p = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
await p.goto('file://' + path.join(root, 'review.html'));
for (const id of [
  'web-goal',
  'web-context',
  'web-source',
  'mobile-source',
  'mobile-city-picker',
  'mobile-history',
  'web-session-loading',
  'web-consultant-open',
  'web-consultant-strip',
  'web-history',
  'mobile-goal',
  'mobile-context',
  'mobile-session-loading',
  'mobile-consultant-open',
]) {
  await p.locator('#' + id).scrollIntoViewIfNeeded();
  await p
    .locator('#' + id)
    .locator('img')
    .evaluateAll((imgs) =>
      Promise.all(
        imgs.map((i) => {
          i.loading = 'eager';
          return i.decode().catch(() => undefined);
        }),
      ),
    );
  await p.locator('#' + id).screenshot({ path: path.join(root, id + '-comparison.png') });
}
await browser.close();
console.log('Expanded gallery and manifest generated:', manifest.length, 'entries');
