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
const MAX_BOOTSTRAP_BYTES = 8 * 1024;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assetKind(name, entryName) {
  if (name === entryName) return 'app';
  if (/^pdf\.worker-[\w-]+\.mjs$/.test(name)) return 'worker';
  if (/^pdf-[\w-]+\.js$/.test(name)) return 'pdf-module';
  throw new Error(`Large browser module needs an explicit loader contract: ${name}`);
}

function partPath(proxyPath, index) {
  return `${proxyPath}.oqpart-${String(index).padStart(3, '0')}`;
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
const REWRITES=${JSON.stringify(rewrites)};
const statusNode=typeof document==="object"?document.querySelector("#root [role=status]"):null;
const setStatus=(text)=>{if(statusNode)statusNode.textContent=text};
const sleep=(delay)=>new Promise(resolve=>setTimeout(resolve,delay));
const pathFor=(index)=>PREFIX+String(index).padStart(3,"0");
async function fetchPart(index){
  let lastError;
  for(let attempt=0;attempt<3;attempt+=1){
    try{
      const response=await fetch(pathFor(index),{cache:attempt===0?"default":"reload",signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const bytes=new Uint8Array(await response.arrayBuffer());
      const expected=index===PART_COUNT-1?LAST_PART_BYTES:PART_BYTES;
      if(bytes.byteLength!==expected)throw new Error("bad part length");
      return bytes;
    }catch(error){
      lastError=error;
      if(attempt<2)await sleep(250*(attempt+1));
    }
  }
  throw new Error("Не удалось загрузить часть "+(index+1)+": "+String(lastError));
}
async function loadSplitModule(){
  void RELEASE;
  const loaded=new Array(PART_COUNT);
  for(let offset=0;offset<PART_COUNT;offset+=6){
    const indexes=Array.from({length:Math.min(6,PART_COUNT-offset)},(_,index)=>offset+index);
    const values=await Promise.all(indexes.map(fetchPart));
    values.forEach((value,index)=>{loaded[offset+index]=value});
    setStatus("Загружаем рабочее пространство — "+Math.round(Math.min(offset+6,PART_COUNT)/PART_COUNT*100)+"%");
  }
  const joined=new Uint8Array(EXPECTED_BYTES);
  let cursor=0;
  for(const value of loaded){joined.set(value,cursor);cursor+=value.byteLength}
  if(cursor!==EXPECTED_BYTES)throw new Error("Неверный размер приложения");
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",joined)),byte=>byte.toString(16).padStart(2,"0")).join("");
  if(digest!==EXPECTED_HASH)throw new Error("Проверка целостности приложения не прошла");
  let source=new TextDecoder().decode(joined);
  for(const [from,to] of REWRITES)source=source.replaceAll(from,location.origin+to);
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
    return `${core}await loadSplitModule();\n//# sourceURL=${options.sourcePath}.bootstrap\n`;
  }
  return `${core}const loadedModule=await loadSplitModule();
${exportBridge(names)}
//# sourceURL=${options.sourcePath}.bootstrap
`;
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

  const entryPath = scriptMatch[1];
  const entryName = basename(entryPath);
  const assetsDirectory = join(distDirectory, 'assets');
  const largeModules = readdirSync(assetsDirectory)
    .filter((name) => /\.(?:js|mjs)$/.test(name))
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

  const entryPlan = largeModules.find((plan) => plan.name === entryName);
  if (!entryPlan) {
    throw new Error('Production entry is unexpectedly smaller than one delivery part');
  }

  const results = [];
  for (const plan of largeModules) {
    const sourceText = plan.source.toString('utf8');
    const rewrites = largeModules.flatMap((target) => {
      const candidates = [
        [`./${target.name}`, target.proxyPath],
        [`/assets/${target.name}`, target.proxyPath],
      ];
      return candidates.filter(([from]) => sourceText.includes(from));
    });
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

  for (const plan of largeModules) {
    unlinkSync(plan.sourceFile);
  }

  const loaderTag = `<script type="module" crossorigin src="${entryPlan.proxyPath}"></script>`;
  let nextHtml = html.replace(scriptMatch[0], loaderTag);
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
  };
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const result = buildSplitDelivery();
  process.stdout.write(
    `split-entry modules=${result.modules.length} parts=${result.modules.reduce((sum, module) => sum + module.partCount, 0)} max_part=${result.partBytes} max_bootstrap=${Math.max(...result.modules.map((module) => module.bootstrapBytes))}\n`,
  );
}
