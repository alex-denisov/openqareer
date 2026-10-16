import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('output/block-0');
const evidence = path.resolve('test-results/evidence');
const groups = [
  ['Первый запуск: источник', 'source', 'S11-WIZ-2', 'step-2-source'],
  ['Загрузка оболочки', 'session-loading', 'BLOCK-0', 'session-loading'],
  ['Первый запуск: цель', 'goal', 'S11-WIZ-2', 'step-1-goal'],
  ['Первый запуск: контекст', 'context', 'S11-WIZ-2', 'step-3-context'],
  ['Диалог с предложением', 'consultant-proposal', 'BLOCK-0', 'consultant-proposal'],
];
const extra = ['consultant-proposal-error', 'decision-accepted', 'decision-dismissed', 'docx-read'];
async function embedded(file) {
  try {
    return `<img loading="lazy" src="data:image/png;base64,${(await fs.readFile(file)).toString('base64')}">`;
  } catch {
    return '<p>Отдельный кадр не снимался.</p>';
  }
}
const sections = [];
for (const width of [390, 1440]) {
  for (const [title, name, folder, actual] of groups) {
    const after = path.join(evidence, folder, `${actual}-${width}.png`);
    await fs.mkdir(path.join(root, 'after'), { recursive: true });
    await fs.copyFile(after, path.join(root, 'after', `${name}-${width}.png`));
    const cells = await Promise.all(
      [
        ['Утверждённый макет', path.join(root, 'reference', `${name}-${width}.png`)],
        ['Было', path.join(root, 'before', `${name}-${width}.png`)],
        ['Стало', after],
      ].map(
        async ([label, file]) =>
          `<figure><figcaption>${label}</figcaption>${await embedded(file)}</figure>`,
      ),
    );
    sections.push(
      `<section id="${name}-${width}"><h2>${title} · ${width}</h2><div class="comparison">${cells.join('')}</div></section>`,
    );
  }
  for (const name of extra)
    sections.push(
      `<section><h2>${name} · ${width}</h2>${await embedded(path.join(evidence, 'BLOCK-0', `${name}-${width}.png`))}</section>`,
    );
}
for (const state of ['loading', 'error', 'empty-queue-no-decision']) {
  sections.push(
    `<section><h2>Сегодня · ${state} · 390</h2><p>Функциональное состояние; отдельного утверждённого кадра для этого состояния нет.</p>${await embedded(path.join(evidence, 'ACC-A-1', `390-${state}.png`))}</section>`,
  );
}
for (const width of [1440, 1280, 1176, 1024, 900]) {
  sections.push(
    `<section><h2>Нативная .app · источник · ${width}</h2>${await embedded(path.join(root, 'native', `final-source-${width}.png`))}</section>`,
  );
}
sections.push(
  `<section><h2>Нативная .app · сохранённый первый запуск после перезапуска</h2>${await embedded(path.join(root, 'native', 'completed-after-restart.png'))}</section>`,
);
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Блок 0 — макет, было, стало</title><style>:root{color-scheme:dark}body{margin:24px;font:16px/1.5 system-ui;background:#080d12;color:#edf1f7}h1,h2{font-weight:600}.comparison{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:0}figcaption{padding:8px 0;font-weight:600}img{display:block;max-width:100%;height:auto}section{margin:40px 0;padding-top:16px;border-top:1px solid #33404c}p{max-width:100ch}</style><h1>Блок 0 — макет, было, стало</h1><p>Локальная проверка без выкладки. Данные демонстрационные и различаются по сценариям. Для сравнения веб-контента из макета убрана нарисованная системная строка iOS и её отступы; оригинальные кадры сохранены в reference/*-original.png. Первоначальные кадры «было» есть для источника и мобильного скелета. Остальные состояния впервые воспроизведены в этой работе.</p><p>Проверки функций и измерения геометрии — в REPORT.md. Эта галерея не подменяет визуальную приёмку владельца и проверку реальных внешних провайдеров.</p>${sections.join('')}</html>`;
await fs.writeFile(path.join(root, 'review.html'), html);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 } });
  await page.goto(`file://${path.join(root, 'review.html')}`);
  for (const name of ['source-390', 'session-loading-390', 'consultant-proposal-390']) {
    await page.locator(`#${name}`).screenshot({ path: path.join(root, `${name}-comparison.png`) });
  }
} finally {
  await browser.close();
}
console.log(`Review gallery: ${path.join(root, 'review.html')}`);
