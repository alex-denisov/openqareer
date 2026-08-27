/**
 * Dumps the computed style of every element on the public and signed-in shells,
 * so a pure-CSS refactor can be proved to change nothing.
 *
 * A stylesheet refactor cannot be checked by reading the diff: moving a rule
 * changes the cascade, and dropping a selector from a grouped rule takes that
 * group's declarations away from every other member. That is exactly how the
 * first attempt at the duplicate cleanup left `.career-wordmark` with the
 * browser's default button chrome, with every test green.
 *
 * Usage — the DOM must be identical on both sides, so only CSS may differ:
 *
 *   git checkout <before> && npm run build && node scripts/capture-computed-styles.mjs before.json
 *   git checkout <after>  && npm run build && node scripts/capture-computed-styles.mjs after.json
 *   node -e "…"  # or any diff of the two JSON files: it must be empty
 */
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const PROPS = [
  'display','position','top','left','right','bottom','width','height','margin','padding',
  'border','border-radius','background-color','background-image','color','font-size','font-weight',
  'font-family','line-height','letter-spacing','text-align','text-decoration','opacity','z-index',
  'flex-direction','justify-content','align-items','gap','grid-template-columns','grid-column',
  'grid-row','overflow','box-shadow','white-space','text-overflow','min-height','max-width','visibility',
];

const out = process.argv[2];

async function dump(page) {
  return page.evaluate((props) => {
    const rows = [];
    const walk = (node, path) => {
      if (!(node instanceof Element)) return;
      const style = getComputedStyle(node);
      const values = {};
      for (const prop of props) values[prop] = style.getPropertyValue(prop);
      rows.push({ path, tag: node.tagName, cls: node.getAttribute('class') || '', values });
      [...node.children].forEach((child, index) => walk(child, `${path}/${index}`));
    };
    walk(document.body, 'body');
    return rows;
  }, PROPS);
}

const server = await preview({ preview: { port: 4321, strictPort: true } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route('**/api/**', async (route) => {
  const { pathname } = new URL(route.request().url());
  if (pathname.startsWith('/api/v1/auth')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          username: 'candidate.test',
          role: 'candidate',
          candidateId: 'candidate-css-check',
          isTest: true,
        },
      }),
    });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":null}' });
});

const screens = {};
await page.goto('http://localhost:4321/', { waitUntil: 'load' });
await page.waitForTimeout(1500);
screens.landing = await dump(page);
await page.goto('http://localhost:4321/app', { waitUntil: 'load' });
await page.waitForTimeout(2500);
screens.app = await dump(page);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
screens.appMobile = await dump(page);
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto('http://localhost:4321/admin', { waitUntil: 'load' });
await page.waitForTimeout(2000);
screens.admin = await dump(page);

await writeFile(out, JSON.stringify(screens, null, 1));
await browser.close();
await server.close();
console.log('written', out, Object.fromEntries(Object.entries(screens).map(([k, v]) => [k, v.length])));
