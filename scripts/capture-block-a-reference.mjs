import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const out = path.resolve(process.env.BLOCK_A_REFERENCE_OUT ?? 'output/block-a/reference');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const inventory = [];
const mobilePages = [
  'home',
  'exp',
  'job',
  'jobedit',
  'jobadd',
  'ats',
  'check',
  'about',
  'edu',
  'proj',
  'lang',
  'reloc',
  'docs',
  'src',
  'skilladd',
];
const profileStates = [
  ['profile-resume', ''],
  ['profile-skills', '&tab=skills&pt=s'],
  ['profile-trace', '&tab=trace&pt=t'],
];
try {
  for (const width of (process.env.BLOCK_A_WIDTHS ?? '1440,1280,1176,1024,900,390')
    .split(',')
    .map(Number)) {
    const page = await browser.newPage({
      viewport: {
        width,
        height: Number(process.env.BLOCK_A_REFERENCE_HEIGHT ?? (width === 390 ? 844 : 900)),
      },
      reducedMotion: 'reduce',
    });
    const states = [
      ...['', '&sheet=open', '&panel=history&sheet=open', '&panel=collapsed'].map(
        (query, index) => [
          ['today', 'today-open', 'today-history', 'today-collapsed'][index],
          '1-segodnya',
          query,
        ],
      ),
      ...profileStates.map(([name, query]) => [name, '2-profil', query]),
      ...(width === 390
        ? mobilePages
            .filter((name) => name !== 'home')
            .map((name) => [`profile-${name}`, '2-profil', `&mv=${name}`])
        : []),
    ];
    for (const [name, screen, query] of states) {
      await page.goto(`http://127.0.0.1:4542/reference-html/${screen}.html?frame${query}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.evaluate(() => document.fonts.ready);
      if (width === 390)
        await page.addStyleTag({
          content:
            ':root{--safe-t:0px;--safe-b:0px}html.is-frame body::before,html.is-frame body::after{display:none}.botnav{inset-block-end:var(--career-space-3)}',
        });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(out, `${name}-viewport-${width}.png`),
        fullPage: false,
        animations: 'disabled',
      });
      await page.screenshot({
        path: path.join(out, `${name}-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      const elements = await page
        .locator(
          '.topbar,.main,.pm,.pm-id,.pm-seg,.pm-group,.pm-row,.summary,.tabs,.anchors,.panel',
        )
        .evaluateAll((nodes) =>
          nodes.flatMap((node) => {
            const r = node.getBoundingClientRect();
            if (!r.width || !r.height) return [];
            const c = getComputedStyle(node);
            return [
              {
                className: node.className,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                padding: c.padding,
                gap: c.gap,
                font: c.font,
                background: c.backgroundColor,
              },
            ];
          }),
        );
      inventory.push({ name, screen, query, width, elements });
    }
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(path.join(out, 'geometry.json'), JSON.stringify(inventory, null, 2));
}
console.log(`Approved HTML reference screenshots: ${inventory.length}`);
