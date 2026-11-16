// B649: переносит стили макетов B640 в новый корень кабинета.
//
//   node scripts/b640/port-mockup-css.mjs <путь к b640.css макетов>
//
// Макеты живут вне репозитория, поэтому результат хранится в git:
//   src/features/b640/tokens.css        — токены и темы (светлая по умолчанию)
//   src/features/b640/styles/base-NN.css — остальные правила, по порядку макета
//
// Что меняется при переносе:
//   - каждое правило получает область `.b640`: `:root` → `.b640`, `body` → `div.b640`,
//     `html` → `div.b640` (или `:not(a)` рядом с `body`), остальное — `.b640 <селектор>`;
//     так сохраняется взаимная специфичность правил макета;
//   - всё лежит в слое каскада `b640`, порядок частей задан слоями `b640.base.pNN`;
//   - `@keyframes` получают приставку `b640-`;
//   - `--font-main` не переносится: шрифт приложения задаёт src/App.css;
//   - комментарии макета не переносятся.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT_CLASS = '.b640';
const PART_MAX_LINES = 700;
const SKIPPED_TOKENS = new Set(['--font-main']);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repoRoot, 'src/features/b640');
const stylesDir = join(outDir, 'styles');

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/b640/port-mockup-css.mjs <b640.css>');
  process.exit(1);
}

/** Делит список селекторов по запятым верхнего уровня. */
function splitSelectors(selector) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of selector) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Ставит один селектор под корень нового кабинета. */
function scopeSelector(selector) {
  if (selector.startsWith(':root')) return ROOT_CLASS + selector.slice(':root'.length);
  const htmlBody = /^html\s+body(?![\w-])/u.exec(selector);
  if (htmlBody) return `div${ROOT_CLASS}:not(a)${selector.slice(htmlBody[0].length)}`;
  const rootElement = /^(html|body)(?![\w-])/u.exec(selector);
  if (rootElement) return `div${ROOT_CLASS}${selector.slice(rootElement[0].length)}`;
  return `${ROOT_CLASS} ${selector}`;
}

/** Формы селектора, которые перенос не умеет: лучше остановиться, чем молча сломать правило. */
const UNSUPPORTED = /(^|[\s>+~(,])(:root|html|body)(?![\w-])|::backdrop/u;

function scopeChecked(selector) {
  const scoped = scopeSelector(selector);
  const rest = scoped.replace(/^(div)?\.b640(:not\(a\))?/u, '');
  if (UNSUPPORTED.test(rest)) {
    throw new Error(`port-mockup-css: селектор не переносится автоматически — ${selector}`);
  }
  return scoped;
}

function isTokenRule(rule) {
  const selectors = splitSelectors(rule.selector);
  if (!selectors.every((selector) => /^:root(\[data-theme="[a-z]+"\])?$/u.test(selector))) {
    return false;
  }
  return rule.nodes.every(
    (node) =>
      node.type === 'comment' ||
      (node.type === 'decl' && (node.prop.startsWith('--') || node.prop === 'color-scheme')),
  );
}

/**
 * Лишняя `}` на верхнем уровне: браузер считает её началом селектора следующего
 * правила и отбрасывает это правило целиком. Делаем то же, чтобы перенос
 * совпадал с тем, что видно в макете.
 */
/** Индекс закрывающей скобки первого блока, который начинается после `from`. */
function endOfNextBlock(text, from) {
  let inner = 0;
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (text[cursor] === '{') inner += 1;
    if (text[cursor] === '}') {
      inner -= 1;
      if (inner === 0) return cursor;
    }
  }
  return text.length;
}

function dropStrayBraces(text) {
  let result = '';
  let depth = 0;
  let index = 0;
  let dropped = 0;
  while (index < text.length) {
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      const stop = end === -1 ? text.length : end + 2;
      result += text.slice(index, stop);
      index = stop;
      continue;
    }
    const char = text[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      if (depth === 0) {
        index = endOfNextBlock(text, index + 1) + 1;
        dropped += 1;
        continue;
      }
      depth -= 1;
    }
    result += char;
    index += 1;
  }
  return { text: result, dropped };
}

const cleaned = dropStrayBraces(readFileSync(source, 'utf8'));
const tree = postcss.parse(cleaned.text, { from: source });

tree.walkComments((comment) => comment.remove());

const keyframes = [];
tree.walkAtRules('keyframes', (atRule) => {
  keyframes.push(atRule.params);
  atRule.params = `b640-${atRule.params}`;
});
tree.walkDecls(/^animation(-name)?$/u, (decl) => {
  for (const name of keyframes) {
    decl.value = decl.value.replace(new RegExp(`(^|[\\s,])${name}(?=$|[\\s,])`, 'gu'), `$1b640-${name}`);
  }
});
tree.walkDecls((decl) => {
  if (SKIPPED_TOKENS.has(decl.prop)) decl.remove();
});

const tokens = postcss.root();
const base = postcss.root();
for (const node of tree.nodes) {
  if (node.type === 'rule' && isTokenRule(node)) {
    tokens.append(node.clone());
    continue;
  }
  if (node.type === 'atrule' && node.name === 'media' && node.nodes?.length) {
    const tokenRules = node.nodes.filter((child) => child.type === 'rule' && isTokenRule(child));
    if (tokenRules.length === node.nodes.length) {
      tokens.append(node.clone());
      continue;
    }
  }
  base.append(node.clone());
}

for (const root of [tokens, base]) {
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/u.test(rule.parent.name)) return;
    rule.selector = splitSelectors(rule.selector).map(scopeChecked).join(',\n');
  });
}

function render(nodes) {
  const root = postcss.root();
  for (const node of nodes) root.append(node.clone());
  return root.toString().trim();
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');
}

const HEADER =
  '/* Сгенерировано scripts/b640/port-mockup-css.mjs из макетов B640. Руками не править:\n' +
  '   правки вносятся в макет и переносятся скриптом. */\n';

mkdirSync(stylesDir, { recursive: true });
for (const name of readdirSync(stylesDir)) {
  if (/^base-\d+\.css$/u.test(name)) rmSync(join(stylesDir, name));
}

writeFileSync(
  join(outDir, 'tokens.css'),
  `${HEADER}@layer b640.tokens {\n${indent(render(tokens.nodes))}\n}\n`,
);

const parts = [];
let current = [];
let currentLines = 0;
for (const node of base.nodes) {
  const lines = node.toString().split('\n').length;
  if (current.length > 0 && currentLines + lines > PART_MAX_LINES) {
    parts.push(current);
    current = [];
    currentLines = 0;
  }
  current.push(node);
  currentLines += lines;
}
if (current.length > 0) parts.push(current);

const partName = (index) => `p${String(index + 1).padStart(2, '0')}`;
parts.forEach((nodes, index) => {
  const file = `base-${String(index + 1).padStart(2, '0')}.css`;
  writeFileSync(
    join(stylesDir, file),
    `${HEADER}@layer b640.base.${partName(index)} {\n${indent(render(nodes))}\n}\n`,
  );
});

writeFileSync(
  join(stylesDir, 'base-layers.css'),
  `${HEADER}@layer ${parts.map((_, index) => `b640.base.${partName(index)}`).join(', ')};\n`,
);
writeFileSync(
  join(stylesDir, 'base.ts'),
  `// Сгенерировано scripts/b640/port-mockup-css.mjs. Руками не править.\n` +
    `import './base-layers.css';\n` +
    parts.map((_, index) => `import './base-${String(index + 1).padStart(2, '0')}.css';`).join('\n') +
    '\n',
);

console.log(`лишних скобок (правило после них отброшено, как в браузере): ${cleaned.dropped}`);
console.log(`tokens.css: ${tokens.nodes.length} правил; base: ${parts.length} частей, keyframes: ${keyframes.join(', ')}`);
