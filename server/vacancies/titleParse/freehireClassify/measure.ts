/**
 * Offline measurement of the freehire classifier (B646-2). Read-only: reads a JSON
 * array of titles, touches no database, calls no model.
 *
 *   npx tsx server/vacancies/titleParse/freehireClassify/measure.ts titles.json
 *
 * freehire alone: IT by our function, confirmed non-IT, adjacent (hardware, creative,
 * project_management, ...), unresolved. Against our rules: titles our rules leave
 * without a function that the fallback now fills, and `other` titles freehire reads as IT
 * (kept as `other`: the fallback never overrides).
 */
import { readFileSync } from 'node:fs';
import { rulesParse } from '../rulesParse';
import { freehireCategory, freehireItFunctionOf, isNonTechCategory } from './classify';

interface Tally {
  total: number;
  itByFunction: Record<string, number>;
  confirmedNonIt: number;
  adjacentIt: number;
  unresolved: number;
  rulesEmptyFilledByFreehire: number;
  rulesOtherFreehireReadsIt: number;
  classifyMsPerTitle: number;
}

function readTitles(path: string): readonly string[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('expected a JSON array of strings');
  }
  return parsed as string[];
}

function measure(titles: readonly string[]): Tally {
  const out: Tally = {
    total: titles.length,
    itByFunction: {},
    confirmedNonIt: 0,
    adjacentIt: 0,
    unresolved: 0,
    rulesEmptyFilledByFreehire: 0,
    rulesOtherFreehireReadsIt: 0,
    classifyMsPerTitle: 0,
  };
  const started = performance.now();
  const categories = titles.map(freehireCategory);
  out.classifyMsPerTitle = titles.length ? (performance.now() - started) / titles.length : 0;
  categories.forEach((category, index) => {
    const fn = freehireItFunctionOf(category);
    if (fn) out.itByFunction[fn] = (out.itByFunction[fn] ?? 0) + 1;
    else if (isNonTechCategory(category)) out.confirmedNonIt += 1;
    else if (category) out.adjacentIt += 1;
    else out.unresolved += 1;
    if (!fn) return;
    const own = rulesParse(titles[index] ?? '', { freehireFallback: false }).functions;
    if (own.length === 0) out.rulesEmptyFilledByFreehire += 1;
    else if (own.length === 1 && own[0] === 'other') out.rulesOtherFreehireReadsIt += 1;
  });
  return out;
}

const path = process.argv[2];
if (!path) {
  process.stderr.write('usage: measure.ts <titles.json>\n');
  process.exit(2);
}
process.stdout.write(`${JSON.stringify(measure(readTitles(path)), null, 2)}\n`);
