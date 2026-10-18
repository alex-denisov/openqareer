import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { readReviewImageMetadata } from './block-a-review-assets.mjs';
import path from 'node:path';

const referenceStems = new Set([
  'today',
  'today-open',
  'today-collapsed',
  'today-history',
  'profile-resume',
  'profile-skills',
  'profile-trace',
]);

const nativeLabels = {
  today: 'Сегодня · основное состояние',
  'today-open': 'Сегодня · консультант открыт',
  'today-collapsed': 'Сегодня · консультант свёрнут',
  'today-history': 'Сегодня · история',
  'profile-resume': 'Профиль · резюме',
  'profile-skills': 'Профиль · навыки',
  'profile-trace': 'Профиль · цифровой след',
  'profile-resume-readonly': 'Профиль · резюме · режим просмотра',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest('hex');
}

async function pngRecord(filePath, logicalWidthCss, assetDirectory, galleryRoot) {
  return readReviewImageMetadata(filePath, assetDirectory, galleryRoot, logicalWidthCss);
}

function parseReferenceFile(filePath) {
  const stem = path.basename(filePath).replace(/\.png$/i, '');
  const viewport = stem.match(/^(.+)-viewport-(\d+)$/);
  if (viewport) {
    return { stem: viewport[1], width: Number(viewport[2]), view: 'viewport' };
  }
  const fullpage = stem.match(/^(.+)-(\d+)$/);
  if (fullpage) {
    return { stem: fullpage[1], width: Number(fullpage[2]), view: 'fullpage' };
  }
  return null;
}

function groupKey(stem, width) {
  return `${stem}::${width}`;
}

function addToGroup(groups, key, value) {
  const entries = groups.get(key) ?? [];
  entries.push(value);
  groups.set(key, entries);
}

const nativeRouteMappings = {
  'today-default': {
    displayStem: 'today',
    referenceStem: 'today',
    label: nativeLabels.today,
  },
  'today-open': {
    displayStem: 'today-open',
    referenceStem: 'today-open',
    label: nativeLabels['today-open'],
  },
  'today-collapsed': {
    displayStem: 'today-collapsed',
    referenceStem: 'today-collapsed',
    label: nativeLabels['today-collapsed'],
  },
  'today-history': {
    displayStem: 'today-history',
    referenceStem: 'today-history',
    label: nativeLabels['today-history'],
  },
  'profile-skills': {
    displayStem: 'profile-skills',
    referenceStem: 'profile-skills',
    label: nativeLabels['profile-skills'],
  },
  'profile-trace': {
    displayStem: 'profile-trace',
    referenceStem: 'profile-trace',
    label: nativeLabels['profile-trace'],
  },
  'profile-resume': {
    displayStem: 'profile-resume-readonly',
    referenceStem: null,
    label: nativeLabels['profile-resume-readonly'],
    mappingReason: 'Read-only capture retained as its own state; no reference pair is asserted.',
  },
  'profile-jobedit': {
    displayStem: 'profile-resume',
    referenceStem: 'profile-resume',
    label: 'Профиль · резюме · редактор места открыт',
    mappingReason:
      'The MarketSoft editor is open in this native capture; it is mapped to the approved Profile resume reference.',
  },
};

const nativeAliases = [
  {
    route: 'today-default',
    referenceStem: 'today',
    reason: 'The native Today default route maps to the approved Today main state.',
  },
  {
    route: 'profile-jobedit',
    referenceStem: 'profile-resume',
    reason:
      'The MarketSoft editor is open in this native capture; it is mapped to the approved Profile resume reference.',
  },
  {
    route: 'profile-resume',
    referenceStem: null,
    reason:
      'The read-only native resume capture remains an additional state without a reference pair.',
  },
];

const nativeWarnings = [
  'The declared native stage is an operator label; a manifest name containing "final" does not make these screenshots a final review.',
  'Current PNGs are preserved as captured. The logical-size preview maps the Retina image to the measured window CSS width; a separate CSS-only crop removes the OS titlebar for viewport comparison.',
  'Current scroll screenshots remain individual frames; no stitched full-page native current image is synthesized.',
  'Unreachable states remain listed with their source reason and are never counted as captured.',
];

function mapRoute(route) {
  return (
    nativeRouteMappings[route] ?? {
      displayStem: route,
      referenceStem: null,
      label: `Native capture · ${route}`,
      mappingReason: null,
    }
  );
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  const width = Number(bounds.Width ?? bounds.width);
  const height = Number(bounds.Height ?? bounds.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    x: Number(bounds.X ?? bounds.x ?? 0),
    y: Number(bounds.Y ?? bounds.y ?? 0),
    width,
    height,
  };
}

function normalizeContentRect(rect) {
  if (!rect) return null;
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    x: Number(rect.x ?? 0),
    y: Number(rect.y ?? 0),
    width,
    height,
  };
}

function logicalFrameMetrics(windowBounds, contentRect) {
  if (!windowBounds) return null;
  const titlebarOffsetCss = contentRect ? Math.max(0, contentRect.y - windowBounds.y) : 0;
  const visibleContentHeightCss = Math.max(
    0,
    Math.min(
      contentRect?.height ?? windowBounds.height - titlebarOffsetCss,
      windowBounds.height - titlebarOffsetCss,
    ),
  );
  return {
    logicalWidthCss: windowBounds.width,
    logicalWindowHeightCss: windowBounds.height,
    titlebarOffsetCss,
    contentWidthCss: Math.min(contentRect?.width ?? windowBounds.width, windowBounds.width),
    contentHeightCss: visibleContentHeightCss,
  };
}

async function nativeCaptureRecord(root, capture, assetDirectory, galleryRoot) {
  const windowBounds = normalizeBounds(capture.windowBounds);
  const contentRect = normalizeContentRect(capture.axWebViewContentRect);
  const logical = logicalFrameMetrics(windowBounds, contentRect);
  const imagePath = (fileName) =>
    path.isAbsolute(fileName) ? fileName : path.join(root, fileName);
  const viewportScreenshot = capture.viewportScreenshot
    ? await pngRecord(
        imagePath(capture.viewportScreenshot),
        logical?.logicalWidthCss ?? null,
        assetDirectory,
        galleryRoot,
      )
    : null;
  const scrollScreenshots = await Promise.all(
    (capture.scrollScreenshots ?? []).map((fileName) =>
      pngRecord(imagePath(fileName), logical?.logicalWidthCss ?? null, assetDirectory, galleryRoot),
    ),
  );

  return {
    route: capture.route,
    requestedWidth: capture.requestedWidth,
    mapping: mapRoute(capture.route),
    viewportScreenshot,
    scrollScreenshots,
    windowBounds,
    axWebViewContentRect: contentRect,
    logicalFrame: logical,
    scrollChangedFrames: capture.scrollChangedFrames ?? null,
    scrollStableAfterNoChange: capture.scrollStableAfterNoChange ?? null,
    scrollSafetyLimit: capture.scrollSafetyLimit ?? null,
  };
}

async function referenceRecords(root, assetDirectory, galleryRoot) {
  const files = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => path.join(root, entry.name));
  const records = [];

  for (const filePath of files) {
    const parsed = parseReferenceFile(filePath);
    if (!parsed || !referenceStems.has(parsed.stem)) continue;
    records.push({
      ...parsed,
      ...(await pngRecord(filePath, parsed.width, assetDirectory, galleryRoot)),
    });
  }

  return records;
}

async function fileProvenance(filePath) {
  if (!(await fileExists(filePath))) return null;
  const fileStat = await stat(filePath);
  return {
    path: path.resolve(filePath),
    bytes: fileStat.size,
    sha256: await sha256(filePath),
  };
}

function statusFor(referenceViewport, captures, unreachable) {
  if (!referenceViewport) return 'missing-reference';
  if (captures.length > 1) return 'ambiguous-current';
  if (captures.length === 1) {
    return captures[0].viewportScreenshot?.exists ? 'paired' : 'missing-current-file';
  }
  if (unreachable.length > 0) return 'unreachable';
  return 'missing-current';
}

function pairStatusCounts(screens) {
  return Object.fromEntries(
    [...new Set(screens.map((screen) => screen.viewportPair.status))]
      .sort()
      .map((status) => [
        status,
        screens.filter((screen) => screen.viewportPair.status === status).length,
      ]),
  );
}

function userFacingStatus(status) {
  const labels = {
    paired: 'Viewport reference and current capture are available',
    unreachable: 'Capture marked unreachable in the source manifest',
    'missing-current': 'No current capture was recorded for this reference state',
    'missing-current-file': 'Capture is listed, but its PNG file is absent',
    'missing-reference': 'No matching native reference viewport exists',
    'ambiguous-current': 'Multiple current captures map to this reference state',
  };
  return labels[status] ?? status;
}

async function readNativeRoots(nativeRoot, nativeReferenceRoot) {
  const currentRoot = path.resolve(nativeRoot);
  const referenceRoot = path.resolve(nativeReferenceRoot);
  const captureManifestPath = path.join(currentRoot, 'native-review-final.json');
  if (!(await fileExists(captureManifestPath))) {
    throw new Error(`Native capture manifest does not exist: ${captureManifestPath}`);
  }
  if (!(await fileExists(referenceRoot))) {
    throw new Error(`Native reference root does not exist: ${referenceRoot}`);
  }

  const sourceManifest = JSON.parse(await readFile(captureManifestPath, 'utf8'));
  const captureManifest = await fileProvenance(captureManifestPath);
  const geometryManifest = await fileProvenance(path.join(referenceRoot, 'geometry.json'));
  return {
    currentRoot,
    referenceRoot,
    sourceManifest,
    captureManifest,
    geometryManifest,
  };
}

async function loadNativeCaptures(roots, assetDirectory, galleryRoot) {
  return Promise.all(
    (roots.sourceManifest.captures ?? []).map((capture) =>
      nativeCaptureRecord(roots.currentRoot, capture, assetDirectory, galleryRoot),
    ),
  );
}

function groupReferenceImages(referenceImageRecords) {
  const groups = new Map();
  for (const record of referenceImageRecords) {
    addToGroup(groups, groupKey(record.stem, record.width), record);
  }
  return groups;
}

function groupNativeCaptures(captures) {
  const capturesByReference = new Map();
  const unpairedCurrentScreens = [];
  for (const capture of captures) {
    const stem = capture.mapping.referenceStem;
    if (!stem) {
      unpairedCurrentScreens.push(capture);
      continue;
    }
    addToGroup(capturesByReference, groupKey(stem, capture.requestedWidth), capture);
  }
  return { capturesByReference, unpairedCurrentScreens };
}

function normalizeUnreachableStates(sourceManifest) {
  return (sourceManifest.unreachableStates ?? []).map((state) => ({
    ...state,
    mapping: mapRoute(state.route),
    status: 'unreachable',
  }));
}

function buildNativeScreens(referenceGroups, capturesByReference, unreachableStates) {
  const screenKeys = [...referenceGroups.keys()].sort((left, right) =>
    left.localeCompare(right, 'en', { numeric: true }),
  );
  return screenKeys.map((key) => {
    const [stem, rawWidth] = key.split('::');
    const width = Number(rawWidth);
    const sourceImages = referenceGroups.get(key) ?? [];
    const currentCaptures = capturesByReference.get(key) ?? [];
    const unreachable = unreachableStates.filter(
      (state) => state.requestedWidth === width && state.mapping.referenceStem === stem,
    );
    const referenceViewport = sourceImages.find((record) => record.view === 'viewport') ?? null;
    const referenceFullpage = sourceImages.find((record) => record.view === 'fullpage') ?? null;
    const status = statusFor(referenceViewport, currentCaptures, unreachable);

    return {
      stem,
      label: currentCaptures[0]?.mapping.label ?? nativeLabels[stem] ?? stem,
      width,
      referenceViewport,
      referenceFullpage,
      viewportPair: {
        status,
        reference: referenceViewport,
        current: currentCaptures[0] ?? null,
      },
      captures: currentCaptures,
      unreachable,
      fullpageMode: 'reference-only-with-current-scroll-sequence',
    };
  });
}

function captureManifestSummary(sourceManifest, provenance, captureCount, unreachableCount) {
  return {
    ...provenance,
    sourceStage: sourceManifest.stage ?? null,
    captureEvidence: sourceManifest.captureEvidence ?? null,
    bundleIdentifier: sourceManifest.bundleIdentifier ?? null,
    processVerified: sourceManifest.processVerified ?? null,
    binaryVerified: sourceManifest.binaryVerified ?? null,
    requestedWidths: sourceManifest.requestedWidths ?? [],
    requestedHeight: sourceManifest.requestedHeight ?? null,
    actualCaptureHeight: sourceManifest.actualCaptureHeight ?? null,
    displayBounds: sourceManifest.displayBounds ?? null,
    originalWindowBounds: sourceManifest.originalWindowBounds ?? null,
    privacy: sourceManifest.privacy ?? null,
    captureCount,
    unreachableCount,
  };
}

function countScrollFrames(captures) {
  return captures.reduce((total, capture) => total + capture.scrollScreenshots.length, 0);
}

export async function buildNativeReview({
  nativeRoot,
  nativeReferenceRoot,
  nativeStage,
  assetDirectory,
  galleryRoot,
}) {
  const roots = await readNativeRoots(nativeRoot, nativeReferenceRoot);
  const [captures, referenceImageRecords] = await Promise.all([
    loadNativeCaptures(roots, assetDirectory, galleryRoot),
    referenceRecords(roots.referenceRoot, assetDirectory, galleryRoot),
  ]);
  const referenceGroups = groupReferenceImages(referenceImageRecords);
  const { capturesByReference, unpairedCurrentScreens } = groupNativeCaptures(captures);
  const unreachableStates = normalizeUnreachableStates(roots.sourceManifest);
  const screens = buildNativeScreens(referenceGroups, capturesByReference, unreachableStates);

  return {
    declaredStage: nativeStage,
    declaredStageSource: 'CLI --native-stage declaration; not inferred from file names',
    currentRoot: roots.currentRoot,
    referenceRoot: roots.referenceRoot,
    captureManifest: captureManifestSummary(
      roots.sourceManifest,
      roots.captureManifest,
      captures.length,
      unreachableStates.length,
    ),
    geometryManifest: roots.geometryManifest,
    requestedViewportWidths: roots.sourceManifest.requestedWidths ?? [],
    expectedReferenceStateCount: screens.length,
    currentCaptureCount: captures.length,
    scrollScreenshotCount: countScrollFrames(captures),
    pairStatusCounts: pairStatusCounts(screens),
    referenceImages: referenceImageRecords,
    screens,
    unpairedCurrentScreens,
    unreachableStates,
    aliases: nativeAliases,
    warnings: nativeWarnings,
  };
}

function imageDimensionsLabel(image) {
  if (!image) return 'Image absent';
  if (!image.exists) return `${image.path} · source PNG absent`;
  return `${image.pixelWidth}×${image.pixelHeight} px · ${image.bytes} bytes · SHA-256 ${image.sha256}`;
}

function rawLink(image) {
  return image?.exists
    ? `<a href="${escapeHtml(image.url)}" target="_blank" rel="noreferrer">Open raw PNG</a>`
    : '<span>Raw PNG unavailable</span>';
}

function referenceFigure(image, title) {
  if (!image) return '<p>Native reference image missing.</p>';
  return `<figure class="native-figure">
    <figcaption><strong>${escapeHtml(title)}</strong><br><code>${escapeHtml(imageDimensionsLabel(image))}</code><br><code>${escapeHtml(image.path)}</code></figcaption>
    <div class="native-image-scroll" tabindex="0" aria-label="Scrollable native reference image: ${escapeHtml(title)}">
      <img src="${escapeHtml(image.url)}" alt="${escapeHtml(title)}" width="${image.pixelWidth ?? ''}" height="${image.pixelHeight ?? ''}" loading="lazy">
    </div>
  </figure>`;
}

function currentFrameFigure(image, capture, title, cropTitlebar) {
  if (!image) return '<p>Current native PNG missing.</p>';
  const logical = capture.logicalFrame;
  if (!image.exists || !logical) {
    return `<figure class="native-figure"><figcaption><strong>${escapeHtml(title)}</strong><br><code>${escapeHtml(imageDimensionsLabel(image))}</code></figcaption>${rawLink(image)}</figure>`;
  }

  const contentHeight = cropTitlebar ? logical.contentHeightCss : logical.logicalWindowHeightCss;
  const translate = cropTitlebar ? logical.titlebarOffsetCss : 0;
  const previewLabel = cropTitlebar
    ? `CSS-only content preview; ${translate}px OS titlebar clipped; source PNG unchanged.`
    : 'Logical-window preview; source PNG unchanged.';

  return `<figure class="native-figure">
    <figcaption><strong>${escapeHtml(title)}</strong><br><code>${escapeHtml(previewLabel)} ${logical.logicalWidthCss}×${contentHeight} CSS px</code><br><code>Window bounds x=${capture.windowBounds.x}, y=${capture.windowBounds.y}, ${capture.windowBounds.width}×${capture.windowBounds.height} CSS px; WebView content rect ${capture.axWebViewContentRect ? `${capture.axWebViewContentRect.width}×${capture.axWebViewContentRect.height} at (${capture.axWebViewContentRect.x}, ${capture.axWebViewContentRect.y})` : 'unavailable'}.</code><br><code>${escapeHtml(imageDimensionsLabel(image))}</code><br><code>${escapeHtml(image.path)}</code> · ${rawLink(image)}</figcaption>
    <div class="native-image-scroll" tabindex="0" aria-label="Scrollable native capture: ${escapeHtml(title)}">
      <div class="native-content-clip" style="--native-width:${logical.logicalWidthCss}px;--native-height:${contentHeight}px;--native-top-trim:${translate}px">
        <img src="${escapeHtml(image.url)}" alt="${escapeHtml(title)}" width="${image.pixelWidth}" height="${image.pixelHeight}" loading="lazy">
      </div>
    </div>
  </figure>`;
}

function captureContext(capture) {
  return `Native capture route ${capture.route}; requested width ${capture.requestedWidth}px; window ${capture.windowBounds ? `${capture.windowBounds.width}×${capture.windowBounds.height} CSS px` : 'bounds unavailable'}; ${capture.scrollScreenshots.length} scroll screenshots recorded; scrollStableAfterNoChange=${capture.scrollStableAfterNoChange}.`;
}

function renderScrollFrames(capture) {
  if (!capture.scrollScreenshots.length)
    return '<p>No scroll screenshots were recorded for this capture.</p>';
  return `<details class="native-scroll-list">
    <summary>${capture.scrollScreenshots.length} additional scroll screenshots · ${escapeHtml(captureContext(capture))}</summary>
    <div class="native-frame-grid">${capture.scrollScreenshots
      .map((image, index) =>
        currentFrameFigure(
          image,
          capture,
          `Current scroll frame ${String(index + 1).padStart(3, '0')}`,
          true,
        ),
      )
      .join('')}</div>
  </details>`;
}

function renderCaptureSupplement(capture) {
  return `<section class="native-current-scrolls">
    <h4>Current scroll frames</h4>
    <p>${escapeHtml(captureContext(capture))} Frames are listed individually and are not stitched together.</p>
    ${renderScrollFrames(capture)}
  </section>`;
}

function renderUnreachable(states) {
  if (!states.length) return '';
  return `<section class="native-unreachable">
    <h3>Unreachable states</h3>
    <ul>${states
      .map(
        (state) =>
          `<li><strong>${escapeHtml(state.mapping.label)}</strong> · ${state.requestedWidth}px · status: unreachable · reason: <code>${escapeHtml(state.reason)}</code></li>`,
      )
      .join('')}</ul>
  </section>`;
}

function renderNativeScreen(screen) {
  const pair = screen.viewportPair;
  const current = pair.current;
  const aliasNote = current?.mapping.mappingReason
    ? `<p class="native-provenance">Explicit route mapping: ${escapeHtml(current.mapping.mappingReason)}</p>`
    : '';
  const pairContent =
    pair.status === 'paired'
      ? `<div class="native-pair">${referenceFigure(pair.reference, 'Approved native viewport reference')}${currentFrameFigure(current.viewportScreenshot, current, 'Current native content viewport', true)}</div>`
      : `<p class="native-status">${escapeHtml(userFacingStatus(pair.status))}</p>${referenceFigure(pair.reference, 'Approved native viewport reference')}`;
  const referenceFull = screen.referenceFullpage
    ? `<section class="native-full-reference"><h4>Full-page native reference</h4>${referenceFigure(screen.referenceFullpage, 'Approved full-page native reference')}<p>Current screenshots are retained as separate scroll frames below; this gallery does not synthesize a stitched native current page.</p></section>`
    : '';
  const scrolls = current ? renderCaptureSupplement(current) : '';
  const unreachable = renderUnreachable(screen.unreachable);

  return `<details class="native-screen" id="native-${escapeHtml(`${screen.stem}-${screen.width}`)}">
    <summary><strong>${escapeHtml(screen.label)}</strong> · ${screen.width}px CSS · ${escapeHtml(userFacingStatus(pair.status))}</summary>
    ${aliasNote}
    ${pairContent}
    ${referenceFull}
    ${scrolls}
    ${unreachable}
  </details>`;
}

function renderNativeOnlyState(capture) {
  const label = capture.mapping.label;
  return `<details class="native-screen" id="native-only-${escapeHtml(`${capture.mapping.displayStem}-${capture.requestedWidth}`)}">
    <summary>${escapeHtml(label)} · ${capture.requestedWidth}px CSS · additional current state, no reference pair</summary>
    <p class="native-status">${escapeHtml(capture.mapping.mappingReason ?? 'No approved native reference state is assigned to this capture.')}</p>
    ${currentFrameFigure(capture.viewportScreenshot, capture, 'Current native content viewport', true)}
    ${renderCaptureSupplement(capture)}
  </details>`;
}

export function renderNativeStyles() {
  return `<style>
    .native-screen { border-block-start: 1px solid currentColor; padding-block: .75rem; }
    .native-screen > summary { cursor: pointer; }
    .native-pair, .native-frame-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; align-items: start; }
    .native-figure { min-inline-size: 0; margin: 0; }
    .native-figure figcaption { overflow-wrap: anywhere; margin-block-end: .5rem; }
    .native-image-scroll { max-block-size: 70vh; overflow: auto; border: 1px solid currentColor; }
    .native-image-scroll > img { display: block; inline-size: auto; block-size: auto; max-inline-size: none; }
    .native-content-clip { position: relative; inline-size: var(--native-width); block-size: var(--native-height); overflow: hidden; }
    .native-content-clip img { display: block; inline-size: var(--native-width); block-size: auto; max-inline-size: none; transform: translateY(calc(-1 * var(--native-top-trim))); transform-origin: top left; }
    .native-scroll-list, .native-full-reference, .native-current-scrolls { margin-block-start: 1rem; }
    .native-scroll-list > summary { cursor: pointer; overflow-wrap: anywhere; }
    .native-status, .native-provenance { overflow-wrap: anywhere; }
    #native pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    @media (max-width: 800px) { .native-pair, .native-frame-grid { grid-template-columns: minmax(0, 1fr); } }
  </style>`;
}

export function renderNativeReviewSection(review) {
  if (!review) return '';
  const screens = review.screens.map(renderNativeScreen).join('');
  const additional = review.unpairedCurrentScreens.map(renderNativeOnlyState).join('');
  const unreachable = review.unreachableStates
    .map((state) => `${state.route} · ${state.requestedWidth}px: ${state.reason}`)
    .join('\n');

  return `<section id="native" aria-labelledby="native-heading">
    <h2 id="native-heading">Native</h2>
    <p>Declared native stage: <strong>${escapeHtml(review.declaredStage)}</strong>. This is the supplied stage label, not a visual-completion verdict.</p>
    <p>Source capture manifest stage: <code>${escapeHtml(review.captureManifest.sourceStage ?? 'unknown')}</code>; capture records: ${review.currentCaptureCount}; scroll screenshots: ${review.scrollScreenshotCount}; unreachable states: ${review.unreachableStates.length}.</p>
    <p>Capture root: <code>${escapeHtml(review.currentRoot)}</code><br>Reference root: <code>${escapeHtml(review.referenceRoot)}</code><br>Manifest source: <code>${escapeHtml(review.captureManifest.path)}</code> · SHA-256 <code>${escapeHtml(review.captureManifest.sha256)}</code>.</p>
    <p>Window PNGs remain untouched. The comparison preview maps the Retina source to each recorded window CSS width and uses a labeled CSS-only titlebar crop; each frame links to its raw PNG. Scroll screenshots stay separate and unreachable states retain their source reasons.</p>
    <p>Source window record: <code>${escapeHtml(JSON.stringify(review.captureManifest.originalWindowBounds))}</code>; source display bounds: <code>${escapeHtml(JSON.stringify(review.captureManifest.displayBounds))}</code>; recorded content height: <code>${escapeHtml(review.captureManifest.actualCaptureHeight)} CSS px</code>.</p>
    <nav aria-label="Native review sections"><a href="#native-states">Native reference states</a> · <a href="#native-additional">Additional current states</a> · <a href="#native-unreachable">Unreachable states</a></nav>
    <section id="native-states" aria-labelledby="native-states-heading"><h3 id="native-states-heading">Reference states</h3>${screens}</section>
    <section id="native-additional" aria-labelledby="native-additional-heading"><h3 id="native-additional-heading">Additional current states</h3>${additional || '<p>No additional native current states.</p>'}</section>
    <section id="native-unreachable" aria-labelledby="native-unreachable-heading"><h3 id="native-unreachable-heading">Source unreachable-state inventory</h3>${unreachable ? `<pre>${escapeHtml(unreachable)}</pre>` : '<p>No unreachable states listed in the source manifest.</p>'}</section>
  </section>`;
}
