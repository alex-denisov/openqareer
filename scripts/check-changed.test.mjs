import { describe, expect, it } from 'vitest';
import { localWorkerLimit, planChecks } from './check-changed.mjs';

const impact = (over = {}) => ({
  unitFiles: [],
  unitTests: [],
  specs: [],
  projects: ['desktop-1440'],
  ...over,
});
const prettierTargets = ['package.json', 'e2e', 'playwright.config.ts'];

describe('planChecks', () => {
  it('lints code files, typechecks app code and runs related unit tests', () => {
    const plan = planChecks(
      ['src/a.tsx', 'server/b.ts', 'README.md'],
      impact({ unitFiles: ['src/a.tsx', 'server/b.ts'] }),
      prettierTargets,
    );
    expect(plan.lintFiles).toEqual(['src/a.tsx', 'server/b.ts']);
    expect(plan.typecheck).toBe(true);
    expect(plan.unitTargets).toEqual(['src/a.tsx', 'server/b.ts']);
    expect(plan.formatFiles).toEqual([]);
  });

  it('skips typecheck for scripts and formats only prettier-owned paths', () => {
    const plan = planChecks(['scripts/x.mjs', 'e2e/foo.spec.ts'], impact(), prettierTargets);
    expect(plan.typecheck).toBe(false);
    expect(plan.formatFiles).toEqual(['e2e/foo.spec.ts']);
  });

  it('rebuilds the preview only when a spec runs and a build input changed', () => {
    const ui = planChecks(['src/a.tsx'], impact({ specs: ['smoke'] }), prettierTargets);
    expect(ui.needsBuild).toBe(true);
    const specOnly = planChecks(
      ['e2e/smoke.spec.ts'],
      impact({ specs: ['smoke'] }),
      prettierTargets,
    );
    expect(specOnly.needsBuild).toBe(false);
    const noSpecs = planChecks(['src/a.tsx'], impact(), prettierTargets);
    expect(noSpecs.needsBuild).toBe(false);
  });

  it('ignores worktree copies under .claude', () => {
    const plan = planChecks(['.claude/worktrees/x/src/a.ts'], impact(), prettierTargets);
    expect(plan.lintFiles).toEqual([]);
  });
});

describe('localWorkerLimit (19.11: хук без лимита грузил Mac до load 500)', () => {
  it('локально ограничивает vitest и Playwright двумя воркерами', () => {
    expect(localWorkerLimit('vitest', {})).toEqual(['--maxWorkers=2']);
    expect(localWorkerLimit('playwright', {})).toEqual(['--workers=2']);
  });
  it('в CI лимит не ставит', () => {
    expect(localWorkerLimit('vitest', { CI: 'true' })).toEqual([]);
    expect(localWorkerLimit('playwright', { CI: 'true' })).toEqual([]);
  });
});
