// Общие типы и помощники гейтов B640 в e2e.
// Источник: _build/gates/_common.mjs макетов B640 (SHOWN_JS, перечень размеров).
import type { Page } from '@playwright/test';

export type GateName =
  | 'first_screen'
  | 'primary_pinned'
  | 'spacing'
  | 'modal_fit'
  | 'row_actions'
  | 'field_height'
  | 'desktop_bottom';

export interface GateFailure {
  readonly gate: GateName;
  readonly size: string;
  readonly message: string;
}

export interface GateReport {
  readonly gate: GateName;
  readonly checked: number;
  readonly failures: readonly GateFailure[];
}

export type GateSize = readonly [number, number];

export interface GateResult {
  checked: number;
  failures: string[];
}

export interface Gate {
  readonly name: GateName;
  readonly sizes: readonly GateSize[];
  run(page: Page, width: number, height: number): Promise<GateResult>;
}

/** Граница между телефоном и десктопом: окно шире 767 px считается десктопным. */
export const DESKTOP_MIN_WIDTH = 768;

/** Размеры гейта, подходящие окну: десктопному — ширины ≥ 768, телефонному — < 768. */
export function sizesForWindow(
  sizes: readonly GateSize[],
  windowWidth: number,
): readonly GateSize[] {
  const desktop = windowWidth >= DESKTOP_MIN_WIDTH;
  return sizes.filter(([width]) => width >= DESKTOP_MIN_WIDTH === desktop);
}

/** Пустой результат: на экране гейту нечего проверять. */
export const NOTHING_TO_CHECK: GateResult = { checked: 0, failures: [] };

/** Корневой элемент нового кабинета: на нём стоят data-template, data-dialog, data-active. */
export const ROOT_SELECTOR = '.b640';

// Тело функции для page.evaluate: видимость элемента (как в _common.mjs макетов).
export const SHOWN_JS = `const shown = (e) => {
  if (e.closest('[hidden], .vh, [aria-hidden=true]')) return false;
  const s = getComputedStyle(e);
  if (s.display === 'none' || s.visibility === 'hidden') return false;
  const b = e.getBoundingClientRect();
  return b.width > 1 && b.height > 1;
};`;
