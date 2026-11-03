import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A `var(--career-…)` that nothing declares silently falls back. With a light
 * fallback (`var(--career-text-primary, #0f172a)`) that is a light form inside
 * the dark shell: the interview debrief rendered its labels at 2.1:1 and its
 * pills at 1.2:1 (B511 G3b item 1). Without a fallback the declaration is
 * dropped and the element inherits whatever is around it.
 *
 * A token counts as declared when any stylesheet declares it (`--career-x:`)
 * or a component sets it by name from TypeScript (`'--career-x'`).
 *
 * KNOWN_UNDEFINED is the debt found when the guard was added (03.11.2026). It
 * may only shrink: a new undefined token fails, and so does an entry that is
 * no longer undefined, so the list always says exactly what is left.
 */
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const KNOWN_UNDEFINED: Readonly<Record<string, readonly string[]>> = {
  'features/applications/responses-mobile.css': ['--career-focus-ring'],
  'features/career-map/careerScreen.css': ['--career-text-muted'],
  'features/interview/mock-interview-flow.css': ['--career-text-2xl'],
  'features/interview/mock-interview-screen.css': ['--career-on-accent'],
  'features/interview/mock-interview.css': ['--career-text-2xl'],
  'features/interview/star-stories.css': ['--career-focus', '--career-surface-soft'],
  'features/journey/consultant-strip.css': ['--career-overlay-bg'],
  'features/notifications/notifications.css': ['--career-text-muted'],
  'features/resume/profileHistory.css': ['--career-surface-muted'],
  'features/shell/career-shell.css': [
    '--career-accent-dim',
    '--career-background',
    '--career-bg-card',
    '--career-border',
    '--career-border-subtle',
    '--career-font-mono',
    '--career-glass-bg',
    '--career-glass-border',
    '--career-line-sm',
    '--career-line-snug',
    '--career-line-subtle',
    '--career-motion-fast',
    '--career-radius-xs',
    '--career-signal-green',
    '--career-space-2xs',
    '--career-space-sm',
    '--career-space-xs',
    '--career-surface-base',
    '--career-surface-hover',
    '--career-surface-muted',
    '--career-surface-soft',
    '--career-surface-subtle',
    '--career-surface-sunken',
    '--career-text-main',
    '--career-text-strong',
    '--career-text-subtle',
  ],
  'features/site/landing.css': ['--career-font'],
  'features/skills/role-skill-assessment.css': ['--career-text-muted'],
  'features/tariffs/tariffs.css': ['--career-radius-circle', '--career-text-base'],
  'features/today/today-desktop.css': ['--career-text-muted'],
  'features/vacancies/s10-vis.css': ['--career-surface-soft'],
  'features/vacancies/vacancies-screen.css': ['--career-focus', '--career-surface-soft'],
  'features/vacancies/vacancy-letter.css': ['--career-radius-circle'],
};

function findFiles(dir: string, pattern: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return findFiles(fullPath, pattern);
    return entry.isFile() && pattern.test(entry.name) ? [fullPath] : [];
  });
}

function declaredTokens(files: readonly string[]): ReadonlySet<string> {
  const declared = new Set<string>();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(--career-[a-z0-9-]+)\s*:/g)) declared.add(match[1]);
    for (const match of text.matchAll(/['"](--career-[a-z0-9-]+)['"]/g)) declared.add(match[1]);
  }
  return declared;
}

function undefinedTokensByFile(): Record<string, string[]> {
  // Tests name tokens without setting them; this file's own list would count.
  const files = findFiles(SRC_DIR, /\.(css|tsx?)$/).filter((name) => !/\.test\.tsx?$/.test(name));
  const declared = declaredTokens(files);
  const result: Record<string, string[]> = {};
  for (const file of files.filter((name) => name.endsWith('.css'))) {
    const text = fs.readFileSync(file, 'utf8');
    const used = [...text.matchAll(/var\(\s*(--career-[a-z0-9-]+)/g)].map((match) => match[1]);
    const missing = [...new Set(used.filter((token) => !declared.has(token)))].sort();
    if (missing.length > 0) result[path.relative(SRC_DIR, file)] = missing;
  }
  return result;
}

describe('CSS token contract', () => {
  it('references no --career token that nothing declares, beyond the recorded debt', () => {
    const expected = Object.fromEntries(
      Object.entries(KNOWN_UNDEFINED).map(([file, tokens]) => [file, [...tokens].sort()]),
    );
    expect(undefinedTokensByFile()).toEqual(expected);
  });

  it('keeps the debrief, reminder and app-update dialogs on declared tokens', () => {
    const actual = undefinedTokensByFile();
    expect(actual['features/applications/interviewDebriefModal.css']).toBeUndefined();
    expect(actual['features/today/companyReminderModal.css']).toBeUndefined();
    expect(actual['features/appUpdate/appUpdate.css']).toBeUndefined();
  });
});
