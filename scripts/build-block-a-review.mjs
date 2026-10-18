import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readReviewImageMetadata, sha256 } from './block-a-review-assets.mjs';
import { readDesignTokenColors } from './block-a-review-tokens.mjs';
import {
  buildNativeReview,
  renderNativeReviewSection,
  renderNativeStyles,
} from './block-a-review-native.mjs';
import { fileURLToPath } from 'node:url';

import { parseBlockAReviewArgs, showBlockAReviewHelp } from './block-a-review-cli.mjs';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(repositoryRoot, 'output', 'block-a');
const viewportWidths = [1440, 1280, 1176, 1024, 900, 390];
const currentStemAliases = [
  {
    currentStem: 'profile-home',
    referenceStem: 'profile-resume',
    widths: [390],
    reason:
      'The mobile capture route named home renders the default Resume tab shown by the approved profile-resume reference.',
  },
];

const stateLabels = {
  today: 'Сегодня · основное состояние',
  'today-open': 'Сегодня · консультант открыт',
  'today-collapsed': 'Сегодня · консультант свёрнут',
  'today-history': 'Сегодня · история',
  'profile-about': 'Профиль · обо мне',
  'profile-ats': 'Профиль · прохождение ATS',
  'profile-check': 'Профиль · проверка',
  'profile-docs': 'Профиль · документы',
  'profile-edu': 'Профиль · образование',
  'profile-exp': 'Профиль · опыт',
  'profile-job': 'Профиль · опыт: просмотр записи',
  'profile-jobadd': 'Профиль · опыт: добавление записи',
  'profile-jobedit': 'Профиль · опыт: редактирование записи',
  'profile-lang': 'Профиль · языки',
  'profile-proj': 'Профиль · проекты',
  'profile-reloc': 'Профиль · релокация',
  'profile-resume': 'Профиль · резюме',
  'profile-resume-readonly': 'Профиль · резюме: просмотр без редактора',
  'profile-skilladd': 'Профиль · добавление навыка',
  'profile-skills': 'Профиль · навыки',
  'profile-src': 'Профиль · источники',
  'profile-trace': 'Профиль · цифровой след',
};

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursively(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }

  await visit(root);
  return files;
}

async function imageMetadata(filePath, assetDirectory, galleryRoot) {
  return readReviewImageMetadata(filePath, assetDirectory, galleryRoot);
}

function parseReferencePng(filePath) {
  const fileName = path.basename(filePath);
  const stem = fileName.replace(/\.png$/i, '');
  const viewportMatch = stem.match(/^(.+)-viewport-(\d+)$/);
  if (viewportMatch) {
    return {
      stem: viewportMatch[1],
      width: Number(viewportMatch[2]),
      view: 'viewport',
    };
  }

  const fullpageMatch = stem.match(/^(.+)-(\d+)$/);
  if (!fullpageMatch) return null;
  return {
    stem: fullpageMatch[1],
    width: Number(fullpageMatch[2]),
    view: 'fullpage',
  };
}

function parseCurrentPng(filePath) {
  const fileName = path.basename(filePath);
  const stem = fileName.replace(/\.png$/i, '');
  const widthMatch = stem.match(/^(.+)-(\d+)$/);
  if (!widthMatch) return null;

  let currentStem = widthMatch[1];
  const width = Number(widthMatch[2]);
  let view = 'viewport';
  let segment = null;

  const regionIndex = currentStem.lastIndexOf('-region-');
  if (regionIndex >= 0) {
    segment = currentStem.slice(regionIndex + 1);
    currentStem = currentStem.slice(0, regionIndex);
    view = 'region';
  } else if (currentStem.endsWith('-full')) {
    currentStem = currentStem.slice(0, -'-full'.length);
    view = 'fullpage';
  } else if (currentStem.endsWith('-bottom')) {
    currentStem = currentStem.slice(0, -'-bottom'.length);
    view = 'bottom';
  }

  const alias = currentStemAliases.find(
    (item) => item.currentStem === currentStem && item.widths.includes(width),
  );

  return {
    stem: alias?.referenceStem ?? currentStem,
    sourceStem: currentStem,
    width,
    view,
    segment,
    alias: alias
      ? {
          from: alias.currentStem,
          to: alias.referenceStem,
          reason: alias.reason,
        }
      : null,
  };
}

function isBlockAReferenceStem(stem) {
  return /^today(?:-(?:open|collapsed|history))?$/.test(stem) || /^profile-[a-z-]+$/.test(stem);
}

function groupKey(stem, width) {
  return `${stem}::${width}`;
}

function addToMap(map, key, value) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function stageLabel(stage) {
  if (stage === 'intermediate') return 'Промежуточный набор снимков';
  if (stage === 'final') return 'Набор снимков с меткой final, указанной оператором';
  return 'Этап набора не подтверждён';
}

function statusMessage(status) {
  const messages = {
    paired: 'Пара собрана',
    'missing-reference': 'Нет снимка макета этого вида',
    'missing-current': 'Нет соответствующего текущего снимка',
    'ambiguous-reference': 'В папке макета найдено несколько снимков этого вида',
    'ambiguous-current': 'В текущих папках найдено несколько снимков этого вида',
  };
  return messages[status] ?? 'Статус не определён';
}

function resolvePair(referenceCandidates, currentCandidates) {
  if (referenceCandidates.length > 1) {
    return { status: 'ambiguous-reference', referenceCandidates, currentCandidates };
  }
  if (referenceCandidates.length === 0) {
    return { status: 'missing-reference', referenceCandidates, currentCandidates };
  }
  if (currentCandidates.length > 1) {
    return { status: 'ambiguous-current', referenceCandidates, currentCandidates };
  }
  if (currentCandidates.length === 0) {
    return { status: 'missing-current', referenceCandidates, currentCandidates };
  }
  return {
    status: 'paired',
    reference: referenceCandidates[0],
    current: currentCandidates[0],
    referenceCandidates,
    currentCandidates,
  };
}

function labelForStem(stem) {
  if (stateLabels[stem]) return stateLabels[stem];
  if (stem.startsWith('today'))
    return `Сегодня · ${stem.slice('today'.length).replace(/^-/, '') || 'состояние'}`;
  if (stem.startsWith('profile-')) return `Профиль · ${stem.slice('profile-'.length)}`;
  return stem;
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function metadataCaption(capture) {
  const dimensions =
    capture.pixelWidth && capture.pixelHeight
      ? `${capture.pixelWidth}×${capture.pixelHeight} px`
      : 'размер PNG не прочитан';
  return `${capture.path} · ${dimensions} · SHA-256 ${capture.sha256}`;
}

function sourceFigure(capture, title, alt) {
  if (!capture) return '';
  return `
    <figure class="capture">
      <figcaption><strong>${htmlEscape(title)}</strong><br><code>${htmlEscape(metadataCaption(capture))}</code></figcaption>
      <div class="image-scroll" tabindex="0" aria-label="Прокручиваемый кадр: ${htmlEscape(title)}">
        <img src="${htmlEscape(capture.url)}" alt="${htmlEscape(alt)}" width="${capture.pixelWidth ?? ''}" height="${capture.pixelHeight ?? ''}" loading="lazy">
      </div>
    </figure>`;
}

function ambiguousCandidates(candidates) {
  if (!candidates.length) return '<p>Файл отсутствует во входных папках.</p>';
  return `<ul>${candidates
    .map((candidate) => `<li><code>${htmlEscape(metadataCaption(candidate))}</code></li>`)
    .join('')}</ul>`;
}

function pairSection(pair, referenceTitle, currentTitle, stateName) {
  const heading = `${referenceTitle} — ${currentTitle}`;
  let bodies = '';

  if (pair.status === 'paired') {
    bodies = `<div class="capture-pair">
      ${sourceFigure(pair.reference, referenceTitle, `${stateName}: ${referenceTitle}`)}
      ${sourceFigure(pair.current, currentTitle, `${stateName}: ${currentTitle}`)}
    </div>`;
  } else {
    const reference = pair.referenceCandidates[0];
    const current = pair.currentCandidates[0];
    const singleFigure =
      pair.status === 'missing-current'
        ? sourceFigure(
            reference,
            `${referenceTitle} · без пары`,
            `${stateName}: ${referenceTitle}; текущий снимок отсутствует`,
          )
        : pair.status === 'missing-reference'
          ? sourceFigure(
              current,
              `${currentTitle} · без пары`,
              `${stateName}: ${currentTitle}; снимок макета отсутствует`,
            )
          : '';
    bodies = `<p class="status">${htmlEscape(statusMessage(pair.status))}</p>
      ${singleFigure}
      ${pair.status.startsWith('ambiguous') ? `<h4>Кандидаты макета</h4>${ambiguousCandidates(pair.referenceCandidates)}<h4>Кандидаты текущих снимков</h4>${ambiguousCandidates(pair.currentCandidates)}` : ''}`;
  }

  return `<section class="view-section" aria-label="${htmlEscape(heading)}">
    <h3>${htmlEscape(heading)}</h3>
    <p class="status">${htmlEscape(statusMessage(pair.status))}</p>
    ${bodies}
  </section>`;
}

function extraCapturesSection(captures, title, stateName) {
  if (!captures.length) return '';
  const items = captures
    .map((capture) => sourceFigure(capture, title(capture), `${stateName}: ${title(capture)}`))
    .join('');
  return `<section class="supplemental" aria-label="Дополнительные текущие кадры">
    <h3>Дополнительные кадры приложения</h3>
    <p>Для этих видов нет отдельного кадра макета; они показаны как самостоятельные источники и не считаются парой.</p>
    <div class="capture-pair">${items}</div>
  </section>`;
}

function renderScreen(screen) {
  const key = `${screen.stem}-${screen.width}`;
  const viewportPair = pairSection(
    screen.pairs.viewport,
    'Макет · область viewport',
    'Текущий снимок · область viewport',
    screen.label,
  );
  const fullpagePair = pairSection(
    screen.pairs.fullpage,
    'Макет · полный экран',
    'Текущий снимок · полный контент',
    screen.label,
  );
  const extras = extraCapturesSection(
    [...screen.current.bottom, ...screen.current.regions],
    (capture) =>
      capture.view === 'bottom'
        ? 'Текущий снимок · нижняя область'
        : `Текущий снимок · ${capture.segment ?? 'дополнительная область'}`,
    screen.label,
  );
  const aliases = screen.current.all
    .filter((capture) => capture.alias)
    .map(
      (capture) =>
        `<p class="provenance">Явное соответствие имён: <code>${htmlEscape(capture.alias.from)}</code> → <code>${htmlEscape(capture.alias.to)}</code>. ${htmlEscape(capture.alias.reason)}</p>`,
    )
    .filter((value, index, list) => list.indexOf(value) === index)
    .join('');

  return `<details class="screen" id="${htmlEscape(key)}">
    <summary><strong>${htmlEscape(screen.label)}</strong> · ${screen.width}px · viewport: ${htmlEscape(screen.pairs.viewport.status)} · полный экран: ${htmlEscape(screen.pairs.fullpage.status)}</summary>
    ${aliases}
    ${viewportPair}
    ${fullpagePair}
    ${extras}
  </details>`;
}

function renderUnpairedCurrent(screen) {
  const currentContent = [
    ...screen.current.viewport,
    ...screen.current.fullpage,
    ...screen.current.bottom,
    ...screen.current.regions,
  ];
  if (currentContent.length === 0) return '';
  return `<details class="screen" id="unpaired-${htmlEscape(`${screen.stem}-${screen.width}`)}">
    <summary>${htmlEscape(labelForStem(screen.stem))} · ${screen.width}px · нет точного reference stem</summary>
    <p class="status">Эта текущая запись не имеет точного имени среди PNG-макетов. Она не включена в сравнение.</p>
    <div class="capture-pair">${currentContent
      .map((capture) =>
        sourceFigure(
          capture,
          `Текущий снимок · ${capture.sourceRootName} · ${capture.view}`,
          `${labelForStem(screen.stem)}: ${capture.view}`,
        ),
      )
      .join('')}</div>
  </details>`;
}

function renderGalleryStyles(colorTokens) {
  return `<style>
    :root {
      color-scheme: light;
      --color-text-primary: ${colorTokens.lightText};
      --color-text-link: ${colorTokens.lightLink};
      --color-surface-page: ${colorTokens.lightSurface};
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --color-text-primary: ${colorTokens.darkText};
      --color-text-link: ${colorTokens.darkLink};
      --color-surface-page: ${colorTokens.darkSurface};
    }
    body {
      color: var(--color-text-primary);
      background: var(--color-surface-page);
      font-family: system-ui, sans-serif;
      margin: 1rem;
    }
    main { max-inline-size: 100%; }
    a { color: var(--color-text-link); }
    .capture-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; align-items: start; }
    .capture { min-inline-size: 0; margin: 0; }
    .capture figcaption { overflow-wrap: anywhere; margin-block-end: .5rem; }
    .image-scroll { max-block-size: 70vh; overflow: auto; border: 1px solid currentColor; }
    .image-scroll img { display: block; inline-size: auto; block-size: auto; max-inline-size: none; }
    .screen { border-block-start: 1px solid currentColor; padding-block: .75rem; }
    .screen > summary { cursor: pointer; }
    .view-section, .supplemental { margin-block-start: 1rem; }
    .status, .provenance { overflow-wrap: anywhere; }
    code { font-size: .875em; overflow-wrap: anywhere; }
    @media (max-width: 800px) {
      .capture-pair { grid-template-columns: minmax(0, 1fr); }
    }
  </style>`;
}

function renderGalleryIntro(manifest) {
  const normalization = manifest.reference.normalization;
  const normalizationText = normalization?.data?.scope
    ? `${normalization.data.scope} ${normalization.data.warning ?? ''}`
    : 'Сведения о нормализации не найдены рядом с reference-каталогом.';
  const rootsText = manifest.currentRoots.length
    ? manifest.currentRoots
        .map(
          (root) =>
            `${root.path} (${root.exists ? stageLabel(root.stage) : 'каталог отсутствует'})`,
        )
        .join('\\n')
    : 'Текущие каталоги не указаны.';

  return `<h1>Block A: макет и текущие снимки</h1>
    <p>Это локальная галерея входных PNG, а не оценка совпадения. Кадры не масштабируются: изображения остаются в исходных пикселях, каждая область прокручивается отдельно.</p>
    <p>Для каждой записи отдельно показаны viewport и полный экран. Нижние и region-кадры приложения вынесены в самостоятельные дополнительные источники, если для них нет отдельного кадра макета.</p>
    <p>Метка текущего набора: <strong>${htmlEscape(stageLabel(manifest.currentStage))}</strong>. Скрипт фиксирует указанную метку, но не проверяет содержимое снимков как финальное.</p>
    <p>Reference: <code>${htmlEscape(manifest.reference.root)}</code>. Текущие источники:<br><code>${htmlEscape(rootsText)}</code></p>
    <p>Происхождение макетов: ${htmlEscape(normalizationText)}</p>
    <p>Реестр происхождения и отсутствующих пар: <a href="review-manifest.json">review-manifest.json</a>.</p>`;
}

function renderGallerySections(manifest) {
  const today = manifest.screens.filter((screen) => screen.stem.startsWith('today'));
  const profile = manifest.screens.filter((screen) => screen.stem.startsWith('profile-'));
  const currentOnly = manifest.unpairedCurrentScreens.map(renderUnpairedCurrent).join('');
  const native = renderNativeReviewSection(manifest.nativeReview);

  return `<section id="today" aria-labelledby="today-heading"><h2 id="today-heading">Сегодня</h2>${today.map(renderScreen).join('')}</section>
    <section id="profile" aria-labelledby="profile-heading"><h2 id="profile-heading">Профиль</h2>${profile.map(renderScreen).join('')}</section>
    <section id="unpaired-current" aria-labelledby="unpaired-heading"><h2 id="unpaired-heading">Текущие снимки без пары</h2>${currentOnly || '<p>Нет дополнительных текущих состояний без reference-файла.</p>'}</section>
    ${native}`;
}

function renderHtml(manifest) {
  const nativeLink = manifest.nativeReview ? ' · <a href="#native">Native</a>' : '';
  const nativeStyles = manifest.nativeReview ? renderNativeStyles() : '';
  return `<!doctype html>
<html lang="ru" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Block A — макет и текущие снимки</title>
  ${renderGalleryStyles(manifest.designTokens)}
  ${nativeStyles}
</head>
<body>
  <main>
    ${renderGalleryIntro(manifest)}
    <nav aria-label="Разделы галереи"><a href="#today">Сегодня</a> · <a href="#profile">Профиль</a> · <a href="#unpaired-current">Текущие снимки без пары</a>${nativeLink}</nav>
    ${renderGallerySections(manifest)}
  </main>
</body>
</html>
`;
}

async function optionalJson(filePath) {
  if (!(await exists(filePath))) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
}

async function optionalFileProvenance(filePath) {
  if (!(await exists(filePath))) return null;
  const fileStat = await stat(filePath);
  return {
    path: path.resolve(filePath),
    bytes: fileStat.size,
    sha256: await sha256(filePath),
    data: await optionalJson(filePath),
  };
}

async function inputRoot(rootPath, stage, kind, allowedWidths) {
  const resolvedPath = path.resolve(rootPath);
  const root = {
    path: resolvedPath,
    stage,
    stageSource: 'CLI --current-stage declaration',
    allowedWidths: allowedWidths ?? null,
    exists: await exists(resolvedPath),
    kind,
    imageCount: 0,
    files: [],
    provenanceFiles: [],
  };
  if (!root.exists) return root;

  root.files = await listFilesRecursively(resolvedPath);
  root.imageCount = root.files.filter((file) => file.toLowerCase().endsWith('.png')).length;
  for (const name of ['capture-inventory.json', 'capture-results.json']) {
    const filePath = path.join(resolvedPath, name);
    const provenance = await optionalFileProvenance(filePath);
    if (provenance) root.provenanceFiles.push(provenance);
  }
  return root;
}

async function readPngRecords(rootRecords, kind, assetDirectory, galleryRoot) {
  const records = [];
  for (const root of rootRecords) {
    if (!root.exists) continue;
    for (const filePath of root.files) {
      if (!filePath.toLowerCase().endsWith('.png')) continue;
      const parsed = kind === 'reference' ? parseReferencePng(filePath) : parseCurrentPng(filePath);
      if (!parsed) continue;
      if (kind === 'current' && root.allowedWidths && !root.allowedWidths.includes(parsed.width)) {
        continue;
      }
      records.push({
        ...parsed,
        root: root.path,
        sourceRootName: path.basename(root.path),
        ...(kind === 'current' ? { stage: root.stage } : {}),
        ...(await imageMetadata(filePath, assetDirectory, galleryRoot)),
      });
    }
  }
  return records;
}

async function stitchManifestFor(currentRoots, stem, width, sourceStems = []) {
  const stems = new Set([stem, ...sourceStems]);
  const paths = currentRoots
    .filter((root) => root.exists && (!root.allowedWidths || root.allowedWidths.includes(width)))
    .flatMap((root) =>
      [...stems].map((sourceStem) => path.join(root.path, `${sourceStem}-stitch-${width}.json`)),
    );
  return (await Promise.all(paths.map(optionalFileProvenance))).filter(Boolean);
}

async function readReferenceData(referenceRoot, assetDirectory, galleryRoot) {
  if (!(await exists(referenceRoot))) {
    throw new Error(`Reference root does not exist: ${referenceRoot}`);
  }
  const rootRecord = {
    path: referenceRoot,
    exists: true,
    files: await listFilesRecursively(referenceRoot),
  };
  rootRecord.imageCount = rootRecord.files.filter((file) =>
    file.toLowerCase().endsWith('.png'),
  ).length;

  const referenceDirectory = path.dirname(referenceRoot);
  const sourceManifest = await optionalFileProvenance(
    path.join(referenceDirectory, 'reference-source-manifest.json'),
  );
  const normalization = await optionalFileProvenance(
    path.join(referenceDirectory, 'reference-normalization.json'),
  );
  const records = (
    await readPngRecords([rootRecord], 'reference', assetDirectory, galleryRoot)
  ).filter((record) => isBlockAReferenceStem(record.stem));

  return { rootRecord, sourceManifest, normalization, records };
}

async function readCurrentRoots(options) {
  return Promise.all(
    options.currentRoots.map((root) =>
      inputRoot(root.path, options.currentStage, 'current capture input', root.widths),
    ),
  );
}

function recordsByKey(records) {
  const grouped = new Map();
  for (const record of records) addToMap(grouped, groupKey(record.stem, record.width), record);
  return grouped;
}

async function createScreenRecord(key, referenceGroups, currentGroups, currentRoots) {
  const [stem, rawWidth] = key.split('::');
  const width = Number(rawWidth);
  const references = referenceGroups.get(key) ?? [];
  const captures = currentGroups.get(key) ?? [];
  const referenceFor = (view) => references.filter((record) => record.view === view);
  const currentFor = (view) => captures.filter((record) => record.view === view);

  return {
    stem,
    label: labelForStem(stem),
    width,
    formFactor: width === 390 ? 'mobile' : 'desktop',
    pairs: {
      viewport: resolvePair(referenceFor('viewport'), currentFor('viewport')),
      fullpage: resolvePair(referenceFor('fullpage'), currentFor('fullpage')),
    },
    current: {
      all: captures,
      viewport: currentFor('viewport'),
      fullpage: currentFor('fullpage'),
      bottom: currentFor('bottom'),
      regions: currentFor('region'),
    },
    captureManifests: await stitchManifestFor(
      currentRoots,
      stem,
      width,
      captures.map((record) => record.sourceStem),
    ),
  };
}

async function buildScreenRecords(referenceRecords, currentRecords, currentRoots) {
  const referenceGroups = recordsByKey(referenceRecords);
  const currentGroups = recordsByKey(currentRecords);
  const keys = [...referenceGroups.keys()].sort((left, right) =>
    left.localeCompare(right, 'en', { numeric: true }),
  );
  const screens = [];

  for (const key of keys) {
    screens.push(await createScreenRecord(key, referenceGroups, currentGroups, currentRoots));
  }

  return { screens, referenceGroups, currentGroups };
}

function buildUnpairedCurrentScreens(currentGroups, referenceGroups) {
  const unmatched = [];
  for (const [key, records] of currentGroups) {
    if (referenceGroups.has(key)) continue;
    const [stem, rawWidth] = key.split('::');
    unmatched.push({
      stem,
      label: labelForStem(stem),
      width: Number(rawWidth),
      current: {
        viewport: records.filter((record) => record.view === 'viewport'),
        fullpage: records.filter((record) => record.view === 'fullpage'),
        bottom: records.filter((record) => record.view === 'bottom'),
        regions: records.filter((record) => record.view === 'region'),
      },
    });
  }
  return unmatched.sort((left, right) =>
    groupKey(left.stem, left.width).localeCompare(groupKey(right.stem, right.width), 'en', {
      numeric: true,
    }),
  );
}

function countPairStatuses(screens) {
  const statuses = screens.flatMap((screen) => [
    screen.pairs.viewport.status,
    screen.pairs.fullpage.status,
  ]);
  return Object.fromEntries(
    [...new Set(statuses)]
      .sort()
      .map((status) => [status, statuses.filter((item) => item === status).length]),
  );
}

function buildWarnings(currentRoots, screens) {
  return [
    'No image similarity metric or visual-match verdict is computed.',
    'Current capture stage comes only from the CLI option; file contents do not prove that a capture set is final.',
    ...currentRoots
      .filter((root) => !root.exists)
      .map((root) => `Current input directory is absent: ${root.path}`),
    ...screens
      .flatMap((screen) => [screen.pairs.viewport, screen.pairs.fullpage])
      .filter((pair) => pair.status.startsWith('ambiguous'))
      .map(
        (pair) =>
          `${pair.status}: one or both input roots contain more than one candidate; no candidate was chosen.`,
      ),
  ];
}

function createReviewManifest(
  options,
  referenceData,
  currentRoots,
  screens,
  unmatched,
  designTokens,
  nativeReview,
) {
  const referenceRecords = referenceData.records;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    currentStage: options.currentStage,
    currentStageSource: 'CLI declaration; not inferred from file contents',
    designTokens,
    reviewAssets: {
      directory: 'review-assets/',
      naming: 'SHA-256 of source PNG plus .png',
      originalsCopiedByteForByte: true,
    },
    requestedViewportWidths: viewportWidths,
    availableReferenceWidths: [...new Set(referenceRecords.map((record) => record.width))].sort(
      (a, b) => b - a,
    ),
    expectedReferenceStateCount: screens.length,
    reference: {
      root: referenceData.rootRecord.path,
      imageCount: referenceData.rootRecord.imageCount,
      sourceManifest: referenceData.sourceManifest,
      normalization: referenceData.normalization,
      sources: referenceRecords,
    },
    currentRoots,
    aliases: currentStemAliases,
    screens,
    unpairedCurrentScreens: unmatched,
    pairStatusCounts: countPairStatuses(screens),
    nativeReview,
    warnings: [
      ...buildWarnings(currentRoots, screens),
      'Gallery image URLs are relative review-assets paths; each manifest image record retains its original source path and hash.',
      ...(nativeReview?.warnings ?? []),
    ],
  };
}

async function buildManifest(options) {
  const referenceRoot = path.resolve(options.referenceRoot);
  const assetDirectory = path.join(outputDirectory, 'review-assets');
  const [referenceData, currentRoots, designTokens] = await Promise.all([
    readReferenceData(referenceRoot, assetDirectory, outputDirectory),
    readCurrentRoots(options),
    readDesignTokenColors(),
  ]);
  const currentRecords = await readPngRecords(
    currentRoots,
    'current',
    assetDirectory,
    outputDirectory,
  );
  const { screens, referenceGroups, currentGroups } = await buildScreenRecords(
    referenceData.records,
    currentRecords,
    currentRoots,
  );
  const unmatched = buildUnpairedCurrentScreens(currentGroups, referenceGroups);
  const nativeReview = options.nativeRoot
    ? await buildNativeReview({
        nativeRoot: options.nativeRoot,
        nativeReferenceRoot: options.nativeReferenceRoot,
        nativeStage: options.nativeStage,
        assetDirectory,
        galleryRoot: outputDirectory,
      })
    : null;

  return createReviewManifest(
    options,
    referenceData,
    currentRoots,
    screens,
    unmatched,
    designTokens,
    nativeReview,
  );
}

async function main() {
  const options = parseBlockAReviewArgs(process.argv.slice(2));
  if (options.help) {
    showBlockAReviewHelp();
    return;
  }

  const manifest = await buildManifest(options);
  await mkdir(outputDirectory, { recursive: true });
  const manifestPath = path.join(outputDirectory, 'review-manifest.json');
  const htmlPath = path.join(outputDirectory, 'review.html');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(htmlPath, renderHtml(manifest), 'utf8');

  process.stdout.write(
    `Wrote ${htmlPath}\nWrote ${manifestPath}\nReference states: ${manifest.expectedReferenceStateCount}\nCurrent roots: ${manifest.currentRoots.length}\nPair statuses: ${JSON.stringify(manifest.pairStatusCounts)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
