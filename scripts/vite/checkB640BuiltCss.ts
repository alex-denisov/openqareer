import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postcss from 'postcss';

/**
 * Guard for logicalVarToPhysical.ts on the built CSS. The system WebKit of the
 * .app drops these declarations under the B640 barrier, while Playwright
 * WebKit is newer and renders them, so an e2e cannot catch a regression.
 * Run after `vite build`: `tsx scripts/vite/checkB640BuiltCss.ts dist`.
 */
const LOGICAL_SHORTHAND =
  /^(?:(?:padding|margin|scroll-padding|scroll-margin|inset)-(?:inline|block)|border-(?:inline|block)(?:-(?:start|end|width|style|color))?)$/u;
const B640_SELECTOR = /\.b640(?![\w-])/u;

/** `file: selector { property: value }` for each offending declaration. */
export function logicalVarShorthands(css: string, file: string): string[] {
  const found: string[] = [];
  postcss.parse(css).walkDecls((declaration) => {
    const rule = declaration.parent;
    if (rule?.type !== 'rule' || !('selector' in rule)) return;
    if (!B640_SELECTOR.test(String(rule.selector))) return;
    if (!LOGICAL_SHORTHAND.test(declaration.prop) || !declaration.value.includes('var(')) return;
    found.push(`${file}: ${String(rule.selector)} { ${declaration.prop}: ${declaration.value} }`);
  });
  return found;
}

export function checkBuiltCss(dist: string): string[] {
  const assets = path.join(dist, 'assets');
  return readdirSync(assets)
    .filter((name) => name.endsWith('.css'))
    .sort()
    .flatMap((name) => logicalVarShorthands(readFileSync(path.join(assets, name), 'utf8'), name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = process.argv[2] ?? 'dist';
  const found = checkBuiltCss(dist);
  if (found.length) {
    console.error(
      `B640: логические сокращения с var() в собранном CSS (${found.length}); окно .app их обнуляет.\n` +
        'Проверьте, что scripts/vite/logicalVarToPhysical.ts подключён в vite.config.ts.\n' +
        found.slice(0, 20).join('\n'),
    );
    process.exit(1);
  }
  console.log(`B640: собранный CSS в ${dist} без логических сокращений с var()`);
}
