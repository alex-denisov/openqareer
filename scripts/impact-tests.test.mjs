import { describe, expect, it } from 'vitest';
import { planImpact } from './impact-tests.mjs';

const map = {
  rules: [
    { prefix: 'src/features/shell/', specs: ['career-shell', 'readability'], projects: 'both' },
    { prefix: 'src/features/resume/', specs: ['profile-screen'] },
    { prefix: 'server/', specs: [], note: 'unit only' },
  ],
};
const existing = ['career-shell', 'readability', 'profile-screen', 'responses-screen'];

describe('planImpact', () => {
  it('maps a shell file to the shell specs in both projects', () => {
    const plan = planImpact(['src/features/shell/Foo.tsx'], map, existing);
    expect(plan.specs.sort()).toEqual(['career-shell', 'readability']);
    expect(plan.projects).toEqual(['desktop-1440', 'mobile-390']);
    expect(plan.unitFiles).toEqual(['src/features/shell/Foo.tsx']);
  });

  it('keeps one project for a non-shared feature and unions specs of several areas', () => {
    const plan = planImpact(
      ['src/features/resume/A.tsx', 'e2e/responses-screen.spec.ts'],
      map,
      existing,
    );
    expect(plan.specs.sort()).toEqual(['profile-screen', 'responses-screen']);
    expect(plan.projects).toEqual(['desktop-1440']);
  });

  it('reports server changes as unit-only and unknown source paths as unmapped', () => {
    const plan = planImpact(['server/app.ts', 'src/features/newarea/X.tsx'], map, existing);
    expect(plan.specs).toEqual([]);
    expect(plan.unmapped).toEqual(['src/features/newarea/X.tsx']);
    expect(plan.notes).toContain('server/: unit only');
  });

  it('skips specs named in the map that are not on disk', () => {
    const plan = planImpact(['src/features/shell/Foo.tsx'], map, ['readability']);
    expect(plan.specs).toEqual(['readability']);
    expect(plan.missingSpecs).toEqual(['career-shell']);
  });
});
