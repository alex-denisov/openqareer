import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ScreenshotTile {
  readonly input: Buffer;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly clearRects: Rect[];
  readonly source: 'scroll' | 'sticky-anchor';
}

interface ScrollFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly total: number;
  readonly contentHeight: number;
  readonly top: number;
  readonly left: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly shellBottom: number;
}

interface StickyAnchor {
  readonly index: number;
  readonly naturalLeft: number;
  readonly naturalTop: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

interface Overlay {
  readonly label: string;
  readonly kind: 'fixed' | 'sticky' | 'mobile-navigation';
  readonly rect: Rect;
  readonly sourceRect?: Rect;
}

interface CaptureSegment {
  readonly scrollTop: number;
  readonly clip: Rect;
  readonly excludedOverlays: Overlay[];
}

function intersect(first: Rect, second: Rect): Rect | null {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function relativeRect(rect: Rect, origin: Rect): Rect | null {
  const clipped = intersect(rect, origin);
  if (!clipped) return null;
  return {
    x: clipped.x - origin.x,
    y: clipped.y - origin.y,
    width: clipped.width,
    height: clipped.height,
  };
}

function mergeRanges(ranges: Array<readonly [number, number]>) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [left, right] of sorted) {
    const last = merged.at(-1);
    if (last && left <= last[1]) last[1] = Math.max(last[1], right);
    else merged.push([left, right]);
  }
  return merged;
}

function subtractRange(
  ranges: Array<readonly [number, number]>,
  cutLeft: number,
  cutRight: number,
) {
  return ranges.flatMap(([left, right]) => {
    if (cutRight <= left || cutLeft >= right) return [[left, right] as const];
    const remaining: Array<readonly [number, number]> = [];
    if (cutLeft > left) remaining.push([left, Math.min(cutLeft, right)]);
    if (cutRight < right) remaining.push([Math.max(cutRight, left), right]);
    return remaining;
  });
}

function uncoveredRows(
  tiles: ScreenshotTile[],
  left: number,
  top: number,
  width: number,
  height: number,
) {
  const missingRows: number[] = [];
  for (let row = 0; row < height; row += 1) {
    const y = top + row;
    const coverage: Array<readonly [number, number]> = [];
    for (const tile of tiles) {
      const localY = y - tile.top;
      if (localY < 0 || localY >= tile.height) continue;
      let ranges: Array<readonly [number, number]> = [[tile.left, tile.left + tile.width]];
      for (const mask of tile.clearRects) {
        const maskTop = Math.floor(mask.y);
        const maskBottom = Math.ceil(mask.y + mask.height);
        if (localY < maskTop || localY >= maskBottom) continue;
        const maskLeft = tile.left + Math.floor(mask.x);
        const maskRight = tile.left + Math.ceil(mask.x + mask.width);
        ranges = subtractRange(ranges, maskLeft, maskRight);
      }
      coverage.push(...ranges);
    }
    const merged = mergeRanges(coverage);
    if (!merged.some(([from, to]) => from <= left && to >= left + width)) missingRows.push(row);
  }

  const runs: Array<{ start: number; end: number }> = [];
  for (const row of missingRows) {
    const previous = runs.at(-1);
    if (previous && previous.end === row) previous.end = row + 1;
    else runs.push({ start: row, end: row + 1 });
  }
  return runs;
}

function scrollTargets(maximum: number, height: number) {
  const step = Math.max(1, Math.floor(height * 0.55));
  const targets = [0];
  for (let top = step; top < maximum; top += step) targets.push(top);
  if (maximum > 0 && targets.at(-1) !== maximum) targets.push(maximum);
  return targets;
}

function supplementalScrollTargets(
  gaps: Array<{ start: number; end: number }>,
  height: number,
  maximum: number,
  alreadyCaptured: Set<number>,
) {
  const candidates = new Set<number>();
  for (const gap of gaps.slice(0, 8)) {
    const middle = (gap.start + gap.end) / 2;
    for (const localY of [0.2, 0.4, 0.6, 0.8]) {
      const target = Math.max(0, Math.min(maximum, Math.round(middle - height * localY)));
      if (!alreadyCaptured.has(target)) candidates.add(target);
    }
  }
  return [...candidates].slice(0, 12);
}

async function waitForStableScroll(main: ReturnType<Page['locator']>) {
  await main.evaluate(async (element) => {
    let previous = element.scrollTop;
    let stableFrames = 0;
    for (let frame = 0; frame < 120 && stableFrames < 3; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const current = element.scrollTop;
      stableFrames = Math.abs(current - previous) < 0.5 ? stableFrames + 1 : 0;
      previous = current;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  });
}

async function stickyAnchors(main: ReturnType<Page['locator']>): Promise<StickyAnchor[]> {
  return main.evaluate((element) => {
    const scrollport = element.getBoundingClientRect();
    const originX = scrollport.left + element.clientLeft;
    const originY = scrollport.top + element.clientTop;
    return Array.from(element.querySelectorAll<HTMLElement>('*')).flatMap((node, index) => {
      if (getComputedStyle(node).position !== 'sticky') return [];
      const rect = node.getBoundingClientRect();
      return [
        {
          index,
          naturalLeft: rect.left - originX + element.scrollLeft,
          naturalTop: rect.top - originY + element.scrollTop,
          width: rect.width,
          height: rect.height,
          label: `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).trim().replace(/\\s+/g, '.')}` : ''}#${index}`,
        },
      ];
    });
  });
}

async function fixedOverlays(page: Page, scrollport: Rect): Promise<Overlay[]> {
  return page.locator('body').evaluate((body, bounds) => {
    const viewport = bounds as Rect;
    return Array.from(body.querySelectorAll<HTMLElement>('*')).flatMap((node, index) => {
      const style = getComputedStyle(node);
      if (
        style.position !== 'fixed' ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
      ) {
        return [];
      }
      const rect = node.getBoundingClientRect();
      const left = Math.max(rect.left, viewport.x);
      const top = Math.max(rect.top, viewport.y);
      const right = Math.min(rect.right, viewport.x + viewport.width);
      const bottom = Math.min(rect.bottom, viewport.y + viewport.height);
      if (right <= left || bottom <= top) return [];
      const classes = String(node.className).trim().replace(/\s+/g, '.');
      return [
        {
          label: `${node.tagName.toLowerCase()}${classes ? `.${classes}` : ''}#${index}`,
          kind: 'fixed' as const,
          rect: { x: left, y: top, width: right - left, height: bottom - top },
        },
      ];
    });
  }, scrollport);
}

async function stickyOverlays(
  main: ReturnType<Page['locator']>,
  anchors: StickyAnchor[],
  scrollport: Rect,
): Promise<Overlay[]> {
  const candidates = await main.evaluate(
    (element, args) => {
      const { anchors, scrollport } = args as {
        anchors: StickyAnchor[];
        scrollport: Rect;
      };
      const nodes = Array.from(element.querySelectorAll<HTMLElement>('*'));
      return anchors.flatMap((anchor) => {
        const node = nodes[anchor.index];
        if (!node) return [];
        const rect = node.getBoundingClientRect();
        const expectedTop = scrollport.y + anchor.naturalTop - element.scrollTop;
        const expectedLeft = scrollport.x + anchor.naturalLeft - element.scrollLeft;
        const isPinned =
          Math.abs(rect.top - expectedTop) > 1 || Math.abs(rect.left - expectedLeft) > 1;
        return isPinned
          ? [
              {
                label: anchor.label,
                rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
              },
            ]
          : [];
      });
    },
    { anchors, scrollport },
  );
  return candidates.flatMap((candidate) => {
    const rect = intersect(candidate.rect, scrollport);
    return rect
      ? [{ label: candidate.label, kind: 'sticky' as const, rect, sourceRect: candidate.rect }]
      : [];
  });
}

async function currentMobileNavigation(page: Page): Promise<Rect | null> {
  const navigation = page.locator('.career-mobile-nav').first();
  if (!(await navigation.count())) return null;
  return navigation.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
}

function masksForTile(overlays: Overlay[], clip: Rect) {
  return overlays.flatMap((overlay) => {
    const mask = relativeRect(overlay.rect, clip);
    return mask ? [mask] : [];
  });
}

async function renderComposite(
  compositor: Page,
  width: number,
  height: number,
  background: string,
  tiles: ScreenshotTile[],
) {
  return compositor.evaluate(
    async ({ width, height, background, tiles }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      for (const tile of tiles) {
        const bytes = Uint8Array.from(atob(tile.png), (character) => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const layer = document.createElement('canvas');
        layer.width = bitmap.width;
        layer.height = bitmap.height;
        const layerContext = layer.getContext('2d')!;
        layerContext.drawImage(bitmap, 0, 0);
        tile.clearRects.forEach((rect) =>
          layerContext.clearRect(rect.x, rect.y, rect.width, rect.height),
        );
        context.drawImage(layer, tile.left, tile.top);
        bitmap.close();
      }
      return canvas.toDataURL('image/png').split(',')[1];
    },
    {
      width,
      height,
      background,
      tiles: tiles.map((tile) => ({
        png: tile.input.toString('base64'),
        left: tile.left,
        top: tile.top,
        clearRects: tile.clearRects,
      })),
    },
  );
}

async function composeTiles(
  page: Page,
  width: number,
  height: number,
  background: string,
  tiles: ScreenshotTile[],
  file: string,
) {
  const compositor = await page.context().browser()!.newPage();
  try {
    const png = await renderComposite(compositor, width, height, background, tiles);
    await fs.writeFile(file, Buffer.from(png, 'base64'));
  } finally {
    await compositor.close();
  }
}

async function captureStickyAnchorTiles(
  page: Page,
  frame: ScrollFrame,
  clip: Rect,
  actualTop: number,
  anchors: StickyAnchor[],
  sticky: Overlay[],
  tiles: ScreenshotTile[],
  captured: Set<number>,
  restored: Set<number>,
) {
  for (const anchor of anchors) {
    const overlay = sticky.find((item) => item.label === anchor.label);
    if (!overlay) {
      const naturalRect = {
        x: frame.x + anchor.naturalLeft - frame.left,
        y: frame.y + anchor.naturalTop - actualTop,
        width: anchor.width,
        height: anchor.height,
      };
      if (intersect(naturalRect, clip)) captured.add(anchor.index);
      continue;
    }
    if (captured.has(anchor.index) || restored.has(anchor.index)) continue;
    const input = await page.screenshot({
      clip: overlay.rect,
      animations: 'disabled',
      scale: 'css',
    });
    const sourceRect = overlay.sourceRect ?? overlay.rect;
    tiles.push({
      input,
      left: Math.round(frame.x + anchor.naturalLeft - frame.left + overlay.rect.x - sourceRect.x),
      top: Math.round(frame.y + anchor.naturalTop + overlay.rect.y - sourceRect.y),
      width: Math.round(overlay.rect.width),
      height: Math.round(overlay.rect.height),
      clearRects: [],
      source: 'sticky-anchor',
    });
    restored.add(anchor.index);
  }
}

async function captureSegment(
  page: Page,
  main: ReturnType<Page['locator']>,
  frame: ScrollFrame,
  anchors: StickyAnchor[],
  fixed: Overlay[],
  target: number,
  tiles: ScreenshotTile[],
  segments: CaptureSegment[],
  capturedStickyAnchors: Set<number>,
  restoredStickyAnchors: Set<number>,
) {
  await main.evaluate((element, top) => {
    element.scrollTop = top;
  }, target);
  await waitForStableScroll(main);
  const actualTop = await main.evaluate((element) => element.scrollTop);
  const clip = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  const sticky = await stickyOverlays(main, anchors, clip);
  const navigationRect = await currentMobileNavigation(page);
  const navigationOverlay = navigationRect ? intersect(navigationRect, clip) : null;
  const navigation: Overlay[] = navigationOverlay
    ? [{ label: '.career-mobile-nav', kind: 'mobile-navigation', rect: navigationOverlay }]
    : [];
  const overlays = [...fixed, ...sticky, ...navigation];
  const input = await page.screenshot({ clip, animations: 'disabled', scale: 'css' });
  tiles.push({
    input,
    left: Math.round(frame.x),
    top: Math.round(frame.y + actualTop),
    width: Math.round(frame.width),
    height: Math.round(frame.height),
    clearRects: masksForTile(overlays, clip),
    source: 'scroll',
  });
  segments.push({ scrollTop: actualTop, clip, excludedOverlays: overlays });
  await captureStickyAnchorTiles(
    page,
    frame,
    clip,
    actualTop,
    anchors,
    sticky,
    tiles,
    capturedStickyAnchors,
    restoredStickyAnchors,
  );
}

interface SegmentBuffer {
  readonly tiles: ScreenshotTile[];
  readonly segments: CaptureSegment[];
  readonly capturedStickyAnchors: Set<number>;
  readonly restoredStickyAnchors: Set<number>;
  readonly positions: Set<number>;
}

interface BottomChrome {
  readonly shellBottom: number;
  readonly bandHeight: number;
  readonly bandRect: Rect;
  readonly band: Buffer | null;
  readonly navigation: Rect | null;
  readonly navigationSeparate: boolean;
  readonly navigationInput: Buffer | null;
}

interface OutputPlan {
  readonly tiles: ScreenshotTile[];
  readonly height: number;
}

async function readScrollFrame(main: ReturnType<Page['locator']>): Promise<ScrollFrame | null> {
  const frame = await main.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const paddingBottom = Number.parseFloat(getComputedStyle(element).paddingBottom) || 0;
    return {
      x: rect.left + element.clientLeft,
      y: rect.top + element.clientTop,
      width: element.clientWidth,
      height: element.clientHeight,
      total: element.scrollHeight,
      contentHeight: Math.max(0, element.scrollHeight - paddingBottom),
      top: element.scrollTop,
      left: element.scrollLeft,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      shellBottom: rect.bottom,
    };
  });
  return frame.width > 0 && frame.height > 0 ? frame : null;
}

async function captureTargets(
  page: Page,
  main: ReturnType<Page['locator']>,
  frame: ScrollFrame,
  anchors: StickyAnchor[],
  fixed: Overlay[],
  targets: number[],
  buffer: SegmentBuffer,
) {
  for (const target of targets) {
    await captureSegment(
      page,
      main,
      frame,
      anchors,
      fixed,
      target,
      buffer.tiles,
      buffer.segments,
      buffer.capturedStickyAnchors,
      buffer.restoredStickyAnchors,
    );
    buffer.positions.add(Math.round(target));
  }
}

async function collectContentSegments(
  page: Page,
  main: ReturnType<Page['locator']>,
  frame: ScrollFrame,
  anchors: StickyAnchor[],
  fixed: Overlay[],
) {
  const buffer: SegmentBuffer = {
    tiles: [],
    segments: [],
    capturedStickyAnchors: new Set<number>(),
    restoredStickyAnchors: new Set<number>(),
    positions: new Set<number>(),
  };
  const maximum = Math.max(0, frame.total - frame.height);
  await captureTargets(
    page,
    main,
    frame,
    anchors,
    fixed,
    scrollTargets(maximum, frame.height),
    buffer,
  );
  let gaps = uncoveredRows(
    buffer.tiles,
    Math.round(frame.x),
    Math.round(frame.y),
    frame.width,
    frame.contentHeight,
  );
  for (let pass = 0; gaps.length > 0 && pass < 3; pass += 1) {
    const extra = supplementalScrollTargets(gaps, frame.height, maximum, buffer.positions);
    if (extra.length === 0) break;
    await captureTargets(page, main, frame, anchors, fixed, extra, buffer);
    gaps = uncoveredRows(
      buffer.tiles,
      Math.round(frame.x),
      Math.round(frame.y),
      frame.width,
      frame.contentHeight,
    );
  }
  return { ...buffer, gaps, maximum };
}

async function captureBottomChrome(
  page: Page,
  main: ReturnType<Page['locator']>,
  frame: ScrollFrame,
  destination: string,
  name: string,
  width: number,
): Promise<BottomChrome> {
  const maximum = Math.max(0, frame.total - frame.height);
  await main.evaluate((element, top) => {
    element.scrollTop = top;
  }, maximum);
  await waitForStableScroll(main);
  const bottomScreenshot = await page.screenshot({ animations: 'disabled', scale: 'css' });
  await fs.writeFile(path.join(destination, `${name}-bottom-${width}.png`), bottomScreenshot);

  const shellBottom = Math.min(frame.viewportHeight, Math.max(0, frame.shellBottom));
  const bandHeight = Math.max(0, frame.viewportHeight - shellBottom);
  const bandRect = { x: 0, y: shellBottom, width: frame.viewportWidth, height: bandHeight };
  const band =
    bandHeight > 0
      ? await page.screenshot({ clip: bandRect, animations: 'disabled', scale: 'css' })
      : null;
  const navigation = await currentMobileNavigation(page);
  const includedInBand = Boolean(
    navigation &&
    navigation.y >= shellBottom - 1 &&
    navigation.y + navigation.height <= frame.viewportHeight + 1,
  );
  const navigationSeparate = Boolean(navigation && !includedInBand);
  const navigationInput =
    navigation && navigationSeparate
      ? await page.screenshot({ clip: navigation, animations: 'disabled', scale: 'css' })
      : null;
  return {
    shellBottom,
    bandHeight,
    bandRect,
    band,
    navigation,
    navigationSeparate,
    navigationInput,
  };
}

function baseChromeTile(
  input: Buffer,
  frame: ScrollFrame,
  footer: BottomChrome,
  initialNavigation: Rect | null,
): ScreenshotTile {
  const viewport = {
    x: 0,
    y: 0,
    width: frame.viewportWidth,
    height: frame.viewportHeight,
  };
  const clearRects = [
    ...(footer.bandHeight > 0
      ? [{ x: 0, y: footer.shellBottom, width: frame.viewportWidth, height: footer.bandHeight }]
      : []),
    ...(initialNavigation && footer.navigationSeparate
      ? [relativeRect(initialNavigation, viewport)].filter((rect): rect is Rect => rect !== null)
      : []),
  ];
  return {
    input,
    left: 0,
    top: 0,
    width: frame.viewportWidth,
    height: frame.viewportHeight,
    clearRects,
    source: 'scroll',
  };
}

function footerTiles(frame: ScrollFrame, footer: BottomChrome, contentBottom: number) {
  const tiles: ScreenshotTile[] = [];
  const navigationTop = footer.navigationSeparate ? contentBottom + footer.bandHeight : 0;
  if (footer.band) {
    tiles.push({
      input: footer.band,
      left: 0,
      top: contentBottom,
      width: frame.viewportWidth,
      height: footer.bandHeight,
      clearRects:
        footer.navigation && footer.navigationSeparate
          ? [relativeRect(footer.navigation, footer.bandRect)].filter(
              (rect): rect is Rect => rect !== null,
            )
          : [],
      source: 'scroll',
    });
  }
  if (footer.navigationInput && footer.navigation) {
    tiles.push({
      input: footer.navigationInput,
      left: Math.round(footer.navigation.x),
      top: Math.round(navigationTop),
      width: Math.round(footer.navigation.width),
      height: Math.round(footer.navigation.height),
      clearRects: [],
      source: 'sticky-anchor',
    });
  }
  return { tiles, navigationTop };
}

function outputPlan(
  frame: ScrollFrame,
  base: Buffer,
  content: ScreenshotTile[],
  footer: BottomChrome,
  initialNavigation: Rect | null,
): OutputPlan {
  const contentBottom = Math.ceil(frame.y + frame.total);
  const baseTile = baseChromeTile(base, frame, footer, initialNavigation);
  const footerPlan = footerTiles(frame, footer, contentBottom);
  const height = Math.ceil(
    Math.max(
      frame.viewportHeight,
      contentBottom + footer.bandHeight,
      footer.navigationSeparate && footer.navigation
        ? footerPlan.navigationTop + footer.navigation.height
        : 0,
    ),
  );
  return {
    tiles: [baseTile, ...content, ...footerPlan.tiles],
    height,
  };
}

async function shellBackground(page: Page) {
  const shell = page.locator('.career-shell').first();
  return (await shell.count())
    ? shell.evaluate((element) => getComputedStyle(element).getPropertyValue('--career-bg'))
    : '#000';
}

async function writeStitchManifest(
  destination: string,
  name: string,
  width: number,
  inventory: unknown,
) {
  await fs.writeFile(
    path.join(destination, `${name}-stitch-${width}.json`),
    JSON.stringify(inventory, null, 2),
  );
}

function stitchManifest(
  name: string,
  width: number,
  frame: ScrollFrame,
  content: Awaited<ReturnType<typeof collectContentSegments>>,
  anchors: StickyAnchor[],
  fixed: Overlay[],
  initialNavigation: Rect | null,
  footer: BottomChrome,
  plan: OutputPlan,
  fullPath: string,
) {
  return {
    name,
    requestedWidth: width,
    viewport: { width: frame.viewportWidth, height: frame.viewportHeight },
    scrollport: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
    scrollHeight: frame.total,
    contentHeight: frame.contentHeight,
    maximumScrollTop: content.maximum,
    scrollTargets: [...content.positions].sort((a, b) => a - b),
    segments: content.segments,
    stickyAnchors: anchors,
    fixedOverlays: fixed,
    mobileNavigation: {
      initial: initialNavigation,
      final: footer.navigation,
      placedSeparatelyAtEnd: footer.navigationSeparate,
    },
    output: {
      width: frame.viewportWidth,
      height: plan.height,
      fullPath,
      bottomPath: path.join(path.dirname(fullPath), `${name}-bottom-${width}.png`),
    },
    uncoveredContentRows: content.gaps,
    contentCoverageComplete: content.gaps.length === 0,
  };
}

async function prepareCapture(page: Page, main: ReturnType<Page['locator']>, frame: ScrollFrame) {
  await main.evaluate((element) => {
    element.scrollTop = 0;
    element.scrollLeft = 0;
  });
  await waitForStableScroll(main);
  return {
    base: await page.screenshot({ animations: 'disabled', scale: 'css' }),
    anchors: await stickyAnchors(main),
    fixed: await fixedOverlays(page, {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    }),
    navigation: await currentMobileNavigation(page),
  };
}

async function buildScrollableEvidence(
  page: Page,
  main: ReturnType<Page['locator']>,
  frame: ScrollFrame,
  destination: string,
  name: string,
  width: number,
) {
  const prepared = await prepareCapture(page, main, frame);
  const { base, anchors, fixed, navigation: initialNavigation } = prepared;
  const content = await collectContentSegments(page, main, frame, anchors, fixed);
  const footer = await captureBottomChrome(page, main, frame, destination, name, width);
  const plan = outputPlan(frame, base, content.tiles, footer, initialNavigation);
  const fullPath = path.join(destination, `${name}-full-${width}.png`);
  await composeTiles(
    page,
    frame.viewportWidth,
    plan.height,
    (await shellBackground(page)) || '#000',
    plan.tiles,
    fullPath,
  );
  await writeStitchManifest(
    destination,
    name,
    width,
    stitchManifest(
      name,
      width,
      frame,
      content,
      anchors,
      fixed,
      initialNavigation,
      footer,
      plan,
      fullPath,
    ),
  );
}

export async function captureScrollableScreen(
  page: Page,
  destination: string,
  name: string,
  width: number,
) {
  if (['city-picker', 'skip-confirm', 'login'].includes(name)) return;
  const main = page.locator('.career-main').first();
  if (!(await main.count())) return;
  const frame = await readScrollFrame(main);
  if (!frame) return;
  try {
    await buildScrollableEvidence(page, main, frame, destination, name, width);
  } finally {
    await main.evaluate(
      (element, previous) => {
        element.scrollTop = previous.top;
        element.scrollLeft = previous.left;
      },
      { top: frame.top, left: frame.left },
    );
  }
}
