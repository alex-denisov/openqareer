// Port of freehire internal/dict/classify (MIT, Copyright (c) 2026 freehire contributors).
// The concatenation order is dictionaries.go `categoryTable`:
// japaneseCategoryTable, coreCategoryTable (parts 1..17), japaneseTrailCategoryTable,
// chineseCategoryTable. Precedence is table order, not title order.
import type { AliasEntry } from './aliasEntry';
import { japaneseLead } from './generated/japaneseLead';
import { core1 } from './generated/core1';
import { core2 } from './generated/core2';
import { core3 } from './generated/core3';
import { core4 } from './generated/core4';
import { core5 } from './generated/core5';
import { core6 } from './generated/core6';
import { core7 } from './generated/core7';
import { core8 } from './generated/core8';
import { core9 } from './generated/core9';
import { core10 } from './generated/core10';
import { core11 } from './generated/core11';
import { core12 } from './generated/core12';
import { core13 } from './generated/core13';
import { core14 } from './generated/core14';
import { core15 } from './generated/core15';
import { core16 } from './generated/core16';
import { core17 } from './generated/core17';
import { japaneseTrail } from './generated/japaneseTrail';
import { chinese } from './generated/chinese';

export { german as GERMAN_TABLE } from './generated/german';
export { dutch as DUTCH_TABLE } from './generated/dutch';
export { danish as DANISH_TABLE } from './generated/danish';
export { spanish as SPANISH_TABLE } from './generated/spanish';
export { portuguese as PORTUGUESE_TABLE } from './generated/portuguese';

export const CATEGORY_TABLE: readonly AliasEntry[] = [
  ...japaneseLead,
  ...core1,
  ...core2,
  ...core3,
  ...core4,
  ...core5,
  ...core6,
  ...core7,
  ...core8,
  ...core9,
  ...core10,
  ...core11,
  ...core12,
  ...core13,
  ...core14,
  ...core15,
  ...core16,
  ...core17,
  ...japaneseTrail,
  ...chinese,
];
