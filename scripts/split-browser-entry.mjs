import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PART_BYTES = 12 * 1024;
/**
 * A bootstrap is itself one response on the public route, so the bound that
 * matters is one delivery part — the same bound every part obeys (B168).
 */
const MAX_BOOTSTRAP_BYTES = 12 * 1024;
const FETCH_CONCURRENCY = 2;
/** Prerendered documents that share the entry bundle with `index.html`. */
const ADDITIONAL_SURFACES = ['admin.html'];

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assetKind(name, entryName) {
  if (name === entryName) return 'app';
  if (/^[\w-]+\.worker-[\w-]+\.(?:js|mjs)$/.test(name)) return 'worker';
  if (/^pdf-[\w-]+\.js$/.test(name)) return 'pdf-module';
  return 'module';
}

function partPath(proxyPath, index) {
  return `${proxyPath}.oqpart-${String(index).padStart(3, '0')}.js`;
}

function loaderCore({
  sourcePath,
  sourceBytes,
  sourceHash,
  proxyPath,
  partBytes,
  partCount,
  lastPartBytes,
  rewrites,
  release,
}) {
  return `const RELEASE=${JSON.stringify(release)};
const SOURCE=${JSON.stringify(sourcePath)};
const EXPECTED_BYTES=${sourceBytes};
const EXPECTED_HASH=${JSON.stringify(sourceHash)};
const PREFIX=${JSON.stringify(`${proxyPath}.oqpart-`)};
const PART_BYTES=${partBytes};
const PART_COUNT=${partCount};
const LAST_PART_BYTES=${lastPartBytes};
const FETCH_CONCURRENCY=${FETCH_CONCURRENCY};
const REWRITES=${JSON.stringify(rewrites)};
const statusNode=typeof document==="object"?document.querySelector("#root [role=status]"):null;
const setStatus=(text)=>{if(statusNode)statusNode.textContent=text};
const sleep=(delay)=>new Promise(resolve=>setTimeout(resolve,delay));
const pathFor=(index)=>PREFIX+String(index).padStart(3,"0")+".js";
const RELOAD_KEY="oq-split-reload";
function releaseMoved(){
  try{
    if(typeof sessionStorage!=="object"||typeof location!=="object")return false;
    if(typeof location.reload!=="function")return false;
    if(sessionStorage.getItem(RELOAD_KEY)===RELEASE)return false;
    sessionStorage.setItem(RELOAD_KEY,RELEASE);
    location.reload();
    return true;
  }catch(error){return false}
}
function staleReleaseError(){
  const error=new Error(releaseMoved()?"Приложение обновилось — перезагружаем страницу…":"Приложение обновилось. Обновите страницу, чтобы продолжить.");
  error.releaseMoved=true;
  return error;
}
async function fetchPart(index){
  let lastError;
  for(let attempt=0;attempt<3;attempt+=1){
    try{
      const response=await fetch(pathFor(index),{cache:attempt===0?"default":"reload",signal:AbortSignal.timeout(45000)});
      if(response.status===404)throw staleReleaseError();
      if((response.headers.get("content-type")||"").includes("html"))throw staleReleaseError();
      if(!response.ok)throw new Error("HTTP "+response.status);
      const bytes=new Uint8Array(await response.arrayBuffer());
      const expected=index===PART_COUNT-1?LAST_PART_BYTES:PART_BYTES;
      if(bytes.byteLength!==expected)throw new Error("часть дошла не целиком: "+bytes.byteLength+" из "+expected+" байт");
      return bytes;
    }catch(error){
      if(error&&error.releaseMoved)throw error;
      lastError=error;
      if(attempt<2)await sleep(250*(attempt+1));
    }
  }
  throw new Error("Не удалось загрузить часть "+(index+1)+": "+String(lastError));
}
async function loadSplitModule(){
  void RELEASE;
  const loaded=new Array(PART_COUNT);
  let nextIndex=0;
  let completed=0;
  async function loadNext(){
    while(nextIndex<PART_COUNT){
      const index=nextIndex;
      nextIndex+=1;
      loaded[index]=await fetchPart(index);
      completed+=1;
      setStatus("Подготавливаем интерфейс — "+Math.round(completed/PART_COUNT*100)+"%");
    }
  }
  const workers=Array.from({length:Math.min(FETCH_CONCURRENCY,PART_COUNT)},()=>loadNext());
  await Promise.all(workers);
  const joined=new Uint8Array(EXPECTED_BYTES);
  let cursor=0;
  for(const value of loaded){joined.set(value,cursor);cursor+=value.byteLength}
  if(cursor!==EXPECTED_BYTES)throw new Error("Неверный размер приложения");
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",joined)),byte=>byte.toString(16).padStart(2,"0")).join("");
  if(digest!==EXPECTED_HASH)throw new Error("Проверка целостности приложения не прошла");
  let source=new TextDecoder().decode(joined);
  for(const [from,to] of REWRITES)source=source.replaceAll(from,location.origin+to);
  try{sessionStorage.removeItem(RELOAD_KEY)}catch(error){void error}
  const objectUrl=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));
  try{return await import(objectUrl)}finally{URL.revokeObjectURL(objectUrl)}
}
`;
}

function exportedNames(source) {
  const matches = [...source.matchAll(/export\{([^}]+)\}/g)];
  if (matches.length === 0) return [];
  return matches.flatMap((match) =>
    match[1].split(',').map((item) => {
      const fields = item.trim().split(/\s+as\s+/);
      return fields.at(-1);
    }),
  );
}

function exportBridge(names) {
  const declarations = names
    .filter((name) => name !== 'default')
    .map(
      (name, index) =>
        `const __oqExport${index}=loadedModule[${JSON.stringify(name)}];`,
    )
    .join('');
  const exports = names
    .filter((name) => name !== 'default')
    .map((name, index) => `__oqExport${index} as ${name}`)
    .join(',');
  const namedExport = exports ? `export{${exports}};` : '';
  const defaultExport = names.includes('default')
    ? 'const __oqDefault=loadedModule.default;export default __oqDefault;'
    : '';
  return declarations + namedExport + defaultExport;
}

function appFailureHandler(sourcePath) {
  return `function showLoadFailure(error){
  const root=document.getElementById("root");
  if(!root)return;
  root.removeAttribute("inert");
  root.removeAttribute("aria-busy");
  root.replaceChildren();
  const box=document.createElement("main");
  box.className="bootstrap-error";
  const title=document.createElement("h1");
  title.textContent="Не удалось открыть рабочее пространство";
  const copy=document.createElement("p");
  copy.textContent="Проверьте соединение и попробуйте ещё раз. Ваши данные не потеряны.";
  const detail=document.createElement("p");
  detail.className="bootstrap-error__detail";
  detail.textContent=String(error instanceof Error?error.message:error);
  const retry=document.createElement("button");
  retry.type="button";
  retry.textContent="Повторить";
  retry.addEventListener("click",()=>location.reload());
  box.append(title,copy,detail,retry);
  root.append(box);
}
//# sourceURL=${sourcePath}.bootstrap
`;
}

function makeBootstrap(options, kind, names) {
  const core = loaderCore(options);
  if (kind === 'app') {
    return `${core}${appFailureHandler(options.sourcePath)}
let loadedModule;
try{loadedModule=await loadSplitModule()}catch(error){showLoadFailure(error);throw error}
${exportBridge(names)}
`;
  }
  if (kind === 'worker') {
    return `${core}const pendingMessages=[];
const queueMessage=(event)=>{event.stopImmediatePropagation();pendingMessages.push({data:event.data,ports:event.ports})};
self.addEventListener("message",queueMessage);
try{await loadSplitModule()}finally{self.removeEventListener("message",queueMessage)}
for(const pending of pendingMessages){self.dispatchEvent(new MessageEvent("message",pending))}
//# sourceURL=${options.sourcePath}.bootstrap
`;
  }
  return `${core}const loadedModule=await loadSplitModule();
${exportBridge(names)}
//# sourceURL=${options.sourcePath}.bootstrap
`;
}

/**
 * Top-level rules of a stylesheet, each returned whole and in cascade order.
 * Concatenating the result reproduces the input byte for byte. Strings and
 * comments are skipped so that a `content:"}"` cannot be read as a block end.
 */
export function topLevelRules(source) {
  const rules = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 1;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        rules.push(source.slice(start, index + 1));
        start = index + 1;
      }
    } else if (character === ';' && depth === 0) {
      rules.push(source.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < source.length) rules.push(source.slice(start));
  return rules;
}

/** At-rules whose body is itself a list of rules, so it can be reopened. */
const REOPENABLE_AT_RULE = /^\s*@(?:media|supports|layer|container|scope)\b/;

/**
 * One rule that is larger than a delivery part, cut into several rules that
 * are not. Only a conditional group rule can be cut this way: repeating its
 * prelude around each group of children is equivalent to the original. A
 * `@keyframes` or a single enormous declaration block has no such identity,
 * so the build fails loudly rather than publishing a response the route drops.
 */
function divideOversizedRule(rule, partBytes) {
  const open = rule.indexOf('{');
  if (open < 0 || !REOPENABLE_AT_RULE.test(rule)) {
    throw new Error(
      `Stylesheet rule of ${rule.length} bytes exceeds the ${partBytes}-byte part and cannot be divided: ${rule.slice(0, 60)}`,
    );
  }
  const prelude = rule.slice(0, open);
  const body = rule.slice(open + 1, rule.lastIndexOf('}'));
  const overhead = prelude.length + 2;
  const groups = packRules(topLevelRules(body), partBytes - overhead);
  return groups.map((group) => `${prelude}{${group}}`);
}

/**
 * Rules packed greedily into chunks of at most `partBytes`, cascade order
 * preserved. Greedy is the only correct strategy here: reordering rules
 * changes which one wins.
 */
export function packRules(rules, partBytes) {
  if (partBytes < 1) throw new Error('partBytes must leave room for at least one byte');
  const chunks = [];
  let current = '';
  for (const rule of rules) {
    const pieces = rule.length > partBytes ? divideOversizedRule(rule, partBytes) : [rule];
    for (const piece of pieces) {
      if (current.length + piece.length > partBytes && current.length > 0) {
        chunks.push(current);
        current = '';
      }
      current += piece;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const STYLESHEET_LINK =
  /<link\s+rel="stylesheet"(?=[^>]*\bhref="(\/assets\/[^"]+\.css)")[^>]*>/;

function stylesheetPartPath(sourcePath, index) {
  return `${sourcePath}.oqpart-${String(index).padStart(3, '0')}.css`;
}

/**
 * B168 — the render-blocking stylesheet is a first-paint response like any
 * other, and the route drops any single response past ~20 KB. Publishing it as
 * ordered bounded links keeps the cascade and keeps every response deliverable.
 */
function buildStylesheetDelivery(distDirectory, html, partBytes) {
  const match = html.match(STYLESHEET_LINK);
  if (!match) return null;

  const sourcePath = match[1];
  const sourceFile = join(distDirectory, sourcePath);
  if (!existsSync(sourceFile)) {
    throw new Error(`Production stylesheet does not exist: ${sourcePath}`);
  }
  const source = readFileSync(sourceFile, 'utf8');
  const chunks = packRules(topLevelRules(source), partBytes);

  chunks.forEach((chunk, index) => {
    writeFileSync(join(distDirectory, stylesheetPartPath(sourcePath, index)), chunk);
  });
  unlinkSync(sourceFile);

  const links = chunks
    .map(
      (unused, index) =>
        `<link rel="stylesheet" crossorigin href="${stylesheetPartPath(sourcePath, index)}">`,
    )
    .join('');

  return {
    linkTag: match[0],
    links,
    partCount: chunks.length,
    sourceBytes: Buffer.byteLength(source),
    sourcePath,
  };
}

export function buildSplitDelivery({
  distDirectory = 'dist',
  release = process.env.VITE_OPENQAREER_RELEASE || 'local',
  partBytes = DEFAULT_PART_BYTES,
} = {}) {
  if (!Number.isInteger(partBytes) || partBytes < 1024 || partBytes > 12 * 1024) {
    throw new Error('partBytes must be an integer between 1024 and 12288');
  }

  const indexPath = join(distDirectory, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  const scriptMatch = html.match(
    /<script\s+type="module"(?=[^>]*\bsrc="(\/assets\/[^"]+\.js)")[^>]*><\/script>/,
  );
  if (!scriptMatch) {
    throw new Error('Production index has no single safe module entry');
  }

  const stylesheet = buildStylesheetDelivery(distDirectory, html, partBytes);

  const entryPath = scriptMatch[1];
  const entryName = basename(entryPath);
  const assetsDirectory = join(distDirectory, 'assets');
  const allAssetNames = readdirSync(assetsDirectory).filter((name) =>
    /\.(?:js|mjs)$/.test(name),
  );

  const largeModules = allAssetNames
    .filter((name) => statSync(join(assetsDirectory, name)).size > partBytes)
    .map((name) => {
      const sourcePath = `/assets/${name}`;
      const sourceFile = join(distDirectory, sourcePath);
      if (!existsSync(sourceFile)) {
        throw new Error(`Production module does not exist: ${sourcePath}`);
      }
      return {
        kind: assetKind(name, entryName),
        name,
        proxyPath: `${sourcePath}.split.js`,
        source: readFileSync(sourceFile),
        sourceFile,
        sourcePath,
      };
    });

  const smallModules = allAssetNames
    .filter((name) => statSync(join(assetsDirectory, name)).size <= partBytes)
    .map((name) => {
      const sourcePath = `/assets/${name}`;
      const sourceFile = join(distDirectory, sourcePath);
      return {
        name,
        sourceFile,
        sourcePath,
      };
    });

  const entryPlan = largeModules.find((plan) => plan.name === entryName);
  if (!entryPlan) {
    throw new Error('Production entry is unexpectedly smaller than one delivery part');
  }

  const results = [];
  for (const plan of largeModules) {
    const sourceText = plan.source.toString('utf8');
    const rewrites = [
      ...largeModules.flatMap((target) => {
        const candidates = [
          [`./${target.name}`, target.proxyPath],
          [`/assets/${target.name}`, target.proxyPath],
        ];
        return candidates.filter(([from]) => sourceText.includes(from));
      }),
      ...smallModules.flatMap((target) => {
        const candidates = [
          [`./${target.name}`, target.sourcePath],
        ];
        return candidates.filter(([from]) => sourceText.includes(from));
      }),
    ];
    const partCount = Math.ceil(plan.source.length / partBytes);
    for (let index = 0; index < partCount; index += 1) {
      const start = index * partBytes;
      const part = plan.source.subarray(
        start,
        Math.min(start + partBytes, plan.source.length),
      );
      writeFileSync(join(distDirectory, partPath(plan.proxyPath, index)), part);
    }
    const names = exportedNames(sourceText);
    const bootstrap = makeBootstrap(
      {
        sourcePath: plan.sourcePath,
        sourceBytes: plan.source.length,
        sourceHash: sha256Hex(plan.source),
        proxyPath: plan.proxyPath,
        partBytes,
        partCount,
        lastPartBytes: plan.source.length - (partCount - 1) * partBytes,
        rewrites,
        release,
      },
      plan.kind,
      names,
    );
    const bootstrapBytes = Buffer.byteLength(bootstrap);
    if (bootstrapBytes > MAX_BOOTSTRAP_BYTES) {
      throw new Error(`${plan.name} bootstrap exceeds ${MAX_BOOTSTRAP_BYTES} bytes`);
    }
    writeFileSync(join(distDirectory, plan.proxyPath), bootstrap);
    results.push({
      bootstrapBytes,
      kind: plan.kind,
      partCount,
      proxyPath: plan.proxyPath,
      sourceBytes: plan.source.length,
      sourceHash: sha256Hex(plan.source),
      sourcePath: plan.sourcePath,
    });
  }

  // Also update small modules remaining on disk if they import split large modules
  for (const small of smallModules) {
    let content = readFileSync(small.sourceFile, 'utf8');
    let changed = false;
    for (const large of largeModules) {
      const relativeRef = `./${large.name}`;
      const absoluteRef = `/assets/${large.name}`;
      if (content.includes(relativeRef)) {
        content = content.replaceAll(relativeRef, `./${large.name}.split.js`);
        changed = true;
      }
      if (content.includes(absoluteRef)) {
        content = content.replaceAll(absoluteRef, large.proxyPath);
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(small.sourceFile, content);
    }
  }

  for (const plan of largeModules) {
    unlinkSync(plan.sourceFile);
  }

  const loaderTag = `<script type="module" crossorigin src="${entryPlan.proxyPath}"></script>`;

  // Every prerendered surface is built from the same Vite output and therefore
  // carries the same entry tag. A surface that keeps the original tag would
  // request a module this step has just deleted, so it boots nothing.
  for (const surface of ADDITIONAL_SURFACES) {
    const surfacePath = join(distDirectory, surface);
    if (!existsSync(surfacePath)) continue;
    const surfaceHtml = readFileSync(surfacePath, 'utf8');
    if (!surfaceHtml.includes(scriptMatch[0])) {
      throw new Error(`${surface} does not carry the production module entry`);
    }
    let nextSurface = surfaceHtml.replace(scriptMatch[0], loaderTag);
    if (stylesheet) {
      if (!nextSurface.includes(stylesheet.linkTag)) {
        throw new Error(`${surface} does not carry the production stylesheet link`);
      }
      nextSurface = nextSurface.replace(stylesheet.linkTag, stylesheet.links);
    }
    writeFileSync(surfacePath, nextSurface);
  }

  let nextHtml = html.replace(scriptMatch[0], loaderTag);
  if (stylesheet) {
    nextHtml = nextHtml.replace(stylesheet.linkTag, stylesheet.links);
  }
  if (!nextHtml.includes('role="status"')) {
    nextHtml = nextHtml.replace(
      '<div id="root"></div>',
      '<div id="root"><main class="bootstrap-loading"><p role="status">Загружаем рабочее пространство…</p></main></div>',
    );
  }
  writeFileSync(indexPath, nextHtml);

  return {
    entryProxyPath: entryPlan.proxyPath,
    partBytes,
    modules: results,
    stylesheets: stylesheet
      ? [
          {
            partCount: stylesheet.partCount,
            sourceBytes: stylesheet.sourceBytes,
            sourcePath: stylesheet.sourcePath,
          },
        ]
      : [],
  };
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const result = buildSplitDelivery();
  process.stdout.write(
    `split-entry modules=${result.modules.length} parts=${result.modules.reduce((sum, module) => sum + module.partCount, 0)} css_parts=${result.stylesheets.reduce((sum, sheet) => sum + sheet.partCount, 0)} max_part=${result.partBytes} max_bootstrap=${Math.max(...result.modules.map((module) => module.bootstrapBytes))}\n`,
  );
}
