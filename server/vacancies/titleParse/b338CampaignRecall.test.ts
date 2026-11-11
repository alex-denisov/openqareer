import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { evaluateSemanticRole } from '../vacancyMatcher';
import type { FunctionCode } from '../../../shared/roleTaxonomy';

interface LabeledTitle {
  readonly f: string;
  readonly t: string;
  readonly expected: 'relevant' | 'irrelevant' | 'unclear';
}

const CAMPAIGN_FUNCTIONS: readonly FunctionCode[] = ['eng-mgmt', 'it-ops', 'exec-general'];
const TARGET_LEVEL = 'vp';

describe('B338-3 — recall и точность отбора кампании IT-руководителя', () => {
  const fixturePath = path.resolve(__dirname, '__fixtures__/b338-labeled.jsonl');
  const lines = fs.readFileSync(fixturePath, 'utf8').trim().split('\n');
  const dataset: readonly LabeledTitle[] = lines.map((l) => JSON.parse(l));

  it('замеряет recall по relevant и долю ошибочных irrelevant', () => {
    let relevantTotal = 0;
    let relevantPassed = 0;
    let irrelevantTotal = 0;
    let irrelevantPassed = 0;

    const misses: string[] = [];
    const leaks: { t: string }[] = [];

    for (const item of dataset) {
      const parsed = evaluateSemanticRole(CAMPAIGN_FUNCTIONS, TARGET_LEVEL, item.t);
      const passed = parsed.roleMatch !== 'none';

      if (item.expected === 'relevant') {
        relevantTotal += 1;
        if (passed) relevantPassed += 1;
        else misses.push(item.t);
      } else if (item.expected === 'irrelevant') {
        irrelevantTotal += 1;
        if (passed) {
          irrelevantPassed += 1;
          leaks.push({ t: item.t });
        }
      }
    }

    const recall = relevantTotal > 0 ? relevantPassed / relevantTotal : 0;
    const irrelevantLeakage = irrelevantTotal > 0 ? irrelevantPassed / irrelevantTotal : 0;

    console.log(`[B338-3 baseline/current] relevant: ${relevantPassed}/${relevantTotal} (${(recall * 100).toFixed(1)}%), irrelevant leak: ${irrelevantPassed}/${irrelevantTotal} (${(irrelevantLeakage * 100).toFixed(1)}%)`);
    console.log('Sample Misses:', misses.slice(0, 20));
    console.log('Sample Leaks:', leaks.slice(0, 20));

    expect(recall).toBeGreaterThanOrEqual(0.85);
    expect(irrelevantLeakage).toBeLessThanOrEqual(0.15);
  });
});
