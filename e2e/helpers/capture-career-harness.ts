import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

export async function captureCareerHarness(
  page: Page,
  path: string,
  selector?: string,
): Promise<void> {
  const rendered = await page.evaluate(async (targetSelector) => {
    const shell = document.querySelector<HTMLElement>('.career-shell');
    if (!shell) throw new Error('career_harness_not_found');
    const target = targetSelector ? shell.querySelector<HTMLElement>(targetSelector) : shell;
    if (!target) throw new Error('career_harness_target_not_found');
    const styles = Array.from(
      document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
        'link[rel="stylesheet"], style',
      ),
    );
    const css = await Promise.all(
      styles.map((style) =>
        style instanceof HTMLLinkElement
          ? fetch(style.href).then((response) => response.text())
          : Promise.resolve(style.textContent ?? ''),
      ),
    );
    const html = targetSelector
      ? `<div class="career-shell">${target.outerHTML}</div>`
      : target.outerHTML +
        Array.from(document.querySelectorAll('body > .career-token-scope'))
          .map((layer) => layer.outerHTML)
          .join('');
    return { css: css.join('\n'), html, title: document.title };
  }, selector);
  writeFileSync(path, renderPage(rendered.css, rendered.html, rendered.title));

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
  writeFileSync(
    path.replace(/\.html$/u, '.rgb.html'),
    renderPage(rgbCss, rendered.html, rendered.title),
  );
}

function renderPage(css: string, html: string, title: string): string {
  const safeTitle = title.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>${css}</style></head><body>${html}</body></html>`;
}
