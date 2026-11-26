#!/usr/bin/env node
/**
 * Замер экрана в системном WebKit macOS — движке окна .app (Tauri), без захвата экрана.
 *
 *   node scripts/webkit-probe.mjs --url http://127.0.0.1:4391/app/adaptation --width 390 \
 *     --selector '.main' --selector '.btn-primary' --png out.png --out out.json
 *
 * Выход: JSON с rect и computed (padding, margin, gap, шрифт, цвета, радиус) для каждого
 * совпадения селектора плюс PNG. Подробности — scripts/webkit-probe/README.md.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, 'webkit-probe/probe.swift');
const BINARY = resolve(HERE, '../node_modules/.cache/webkit-probe/probe');
const SESSION_COOKIE = 'openqareer_session';

const OPTIONS = {
  url: { type: 'string' },
  width: { type: 'string', default: '1440' },
  height: { type: 'string', default: '900' },
  selector: { type: 'string', multiple: true, default: [] },
  'wait-for': { type: 'string' },
  png: { type: 'string' },
  'full-page': { type: 'boolean', default: false },
  session: { type: 'string' },
  cookie: { type: 'string', multiple: true, default: [] },
  'local-storage': { type: 'string', multiple: true, default: [] },
  theme: { type: 'string' },
  'init-script': { type: 'string' },
  settle: { type: 'string', default: '500' },
  timeout: { type: 'string', default: '20000' },
  out: { type: 'string' },
  help: { type: 'boolean', default: false },
};

const USAGE = `Использование: node scripts/webkit-probe.mjs --url <адрес|файл> [--width 1440] [--height 900]
  --selector <css>        что мерить (можно несколько раз)
  --wait-for <css>        ждать появления элемента перед замером
  --png <файл>            снимок; --full-page — на всю высоту документа
  --session <токен>       cookie сессии ${SESSION_COOKIE} для домена адреса (без пароля)
  --cookie name=value     любая cookie для домена адреса
  --local-storage k=v     запись localStorage до загрузки страницы
  --theme light|dark      тема кабинета (oq_b640_theme)
  --init-script <файл>    JS до скриптов страницы (заглушки fetch для dist с фикстурой)
  --settle <мс>           пауза после готовности (500), --timeout <мс> (20000)
  --out <файл>            JSON в файл, иначе в stdout`;

function positiveInt(name, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`--${name}: нужно целое больше нуля, получено «${raw}»`);
  return value;
}

function pair(name, raw) {
  const at = raw.indexOf('=');
  if (at <= 0) throw new Error(`--${name}: нужен вид ключ=значение, получено «${raw}»`);
  return [raw.slice(0, at), raw.slice(at + 1)];
}

function targetUrl(raw) {
  if (/^(https?|file):\/\//.test(raw)) return new URL(raw);
  return pathToFileURL(resolve(raw));
}

/** Аргументы командной строки → конфиг для probe.swift. */
export function parseProbeArgs(argv, readText = (path) => readFileSync(path, 'utf8')) {
  const { values } = parseArgs({
    args: argv,
    options: OPTIONS,
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return { help: true };
  if (!values.url) throw new Error('--url обязателен');
  const url = targetUrl(values.url);
  const domain = url.hostname;
  const cookies = values.cookie
    .map((raw) => pair('cookie', raw))
    .map(([name, value]) => ({ name, value, domain }));
  if (values.session) cookies.push({ name: SESSION_COOKIE, value: values.session, domain });
  if ((values.session || values.cookie.length) && url.protocol === 'file:')
    throw new Error('cookie не применимы к файлу');
  const localStorage = Object.fromEntries(
    values['local-storage'].map((raw) => pair('local-storage', raw)),
  );
  if (values.theme) {
    if (!['light', 'dark'].includes(values.theme)) throw new Error('--theme: light или dark');
    localStorage.oq_b640_theme = values.theme;
  }
  return {
    out: values.out ?? null,
    config: {
      url: url.href,
      width: positiveInt('width', values.width),
      height: positiveInt('height', values.height),
      selectors: values.selector,
      waitFor: values['wait-for'] ?? null,
      settleMs: positiveInt('settle', values.settle),
      timeoutMs: positiveInt('timeout', values.timeout),
      png: values.png ? resolve(values.png) : null,
      fullPage: values['full-page'],
      cookies,
      localStorage,
      initScript: values['init-script'] ? readText(values['init-script']) : null,
    },
  };
}

/** Собирает probe.swift, если бинарника нет или исходник новее. */
function ensureBinary() {
  if (existsSync(BINARY) && statSync(BINARY).mtimeMs >= statSync(SOURCE).mtimeMs) return BINARY;
  mkdirSync(dirname(BINARY), { recursive: true });
  const built = spawnSync('swiftc', ['-O', SOURCE, '-o', BINARY], { stdio: 'inherit' });
  if (built.status !== 0)
    throw new Error('swiftc не собрал probe.swift (нужен Xcode Command Line Tools)');
  return BINARY;
}

function run(config) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(ensureBinary(), [], { stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolveRun(stdout) : reject(new Error(`probe завершился с кодом ${code}`)),
    );
    child.stdin.end(JSON.stringify(config));
  });
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('webkit-probe работает только на macOS');
  const parsed = parseProbeArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const json = JSON.stringify(JSON.parse(await run(parsed.config)), null, 2);
  if (parsed.out) writeFileSync(parsed.out, `${json}\n`);
  else process.stdout.write(`${json}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`webkit-probe: ${error.message}\n\n${USAGE}\n`);
    process.exit(1);
  });
}
