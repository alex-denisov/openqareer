// Семь гейтов макетов B640, перенесённых в e2e: гоняются на уже открытой странице приложения.
// Источник: _build/gates/ макетов B640 (verify_*.mjs).
import type { Page } from '@playwright/test';
import type { Gate, GateFailure, GateName, GateReport } from './common';
import { sizesForWindow } from './common';
import { desktopBottomGate } from './desktopBottom';
import { fieldHeightGate } from './fieldHeight';
import { firstScreenGate } from './firstScreen';
import { modalFitGate } from './modalFit';
import { primaryPinnedGate } from './primaryPinned';
import { rowActionsGate } from './rowActions';
import { spacingGate } from './spacing';

export type { Gate, GateFailure, GateName, GateReport } from './common';

export const GATES: readonly Gate[] = [
  firstScreenGate,
  primaryPinnedGate,
  spacingGate,
  modalFitGate,
  rowActionsGate,
  fieldHeightGate,
  desktopBottomGate,
];

export interface RunGatesOptions {
  readonly only?: readonly GateName[];
}

async function settleLayout(page: Page): Promise<void> {
  const frame = (): Promise<void> =>
    page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  await frame();
  await frame();
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Гоняет гейты на открытой странице на размерах, подходящих текущему окну: окно шире 767 px —
 * размеры ≥ 768, иначе — размеры < 768. Возвращает отчёты; окно возвращает к исходному размеру.
 */
export async function runGates(page: Page, options: RunGatesOptions = {}): Promise<GateReport[]> {
  const original = page.viewportSize();
  if (!original) throw new Error('runGates: у страницы нет размера окна (viewport: null)');
  const gates = GATES.filter((g) => !options.only || options.only.includes(g.name));
  const reports: GateReport[] = [];
  try {
    for (const gate of gates) {
      let checked = 0;
      const failures: GateFailure[] = [];
      for (const [width, height] of sizesForWindow(gate.sizes, original.width)) {
        await page.setViewportSize({ width, height });
        await settleLayout(page);
        const result = await gate.run(page, width, height);
        checked += result.checked;
        for (const message of result.failures) {
          failures.push({ gate: gate.name, size: `${width}×${height}`, message });
        }
      }
      reports.push({ gate: gate.name, checked, failures });
    }
  } finally {
    await page.setViewportSize(original);
    await settleLayout(page);
  }
  return reports;
}

/** То же и падает одним понятным сообщением: гейт, размер, что не так. */
export async function expectGates(page: Page, options: RunGatesOptions = {}): Promise<void> {
  const reports = await runGates(page, options);
  const lines = reports.flatMap((r) => r.failures.map((f) => `${f.gate} @${f.size}: ${f.message}`));
  if (lines.length) {
    throw new Error(`Гейты B640: ${lines.length} нарушений\n${lines.join('\n')}`);
  }
}
