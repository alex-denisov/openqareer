import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

export async function captureCareerHarness(page: Page, path: string): Promise<void> {
  const rendered = await page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>('.career-shell');
    if (!shell) throw new Error('career_harness_not_found');
    const linkedStyles = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    );
    const linkedCss = await Promise.all(
      linkedStyles.map((style) => fetch(style.href).then((response) => response.text())),
    );
    const inlineCss = Array.from(document.querySelectorAll('style')).map(
      (style) => style.textContent ?? '',
    );
    return { css: [...inlineCss, ...linkedCss].join('\n'), html: shell.outerHTML };
  });
  writeFileSync(path, renderPage(rendered.css, rendered.html));

  const colors = Array.from(new Set(rendered.css.match(/oklch\([^)]*\)/gu) ?? []));
  const resolvedColors = await page.evaluate((values) => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('canvas_context_missing');
    return values.map((color) => {
      if (!CSS.supports('color', color)) return [color, color] as const;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      return [color, `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`] as const;
    });
  }, colors);
  const replacements = new Map(resolvedColors);
  const rgbCss = rendered.css.replace(
    /oklch\([^)]*\)/gu,
    (color) => replacements.get(color) ?? color,
  );
  writeFileSync(path.replace(/\.html$/u, '.rgb.html'), renderPage(rgbCss, rendered.html));
}

function renderPage(css: string, html: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`;
}
