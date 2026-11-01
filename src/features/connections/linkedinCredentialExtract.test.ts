// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSkillsPage } from './linkedinCredentialExtract';

// The shell's per-step skill collector (src-tauri/src/skills_collect.js) hands
// back minimal rows; the parser must read every one of them (B591).
const row = (id: number, ...lines: string[]) =>
  `<div id="com.linkedin.sdui.profile.skill(ACoA, ${id})">${lines.map((l) => `<p>${l}</p>`).join('')}</div>`;

describe('parseSkillsPage on collected rows', () => {
  it('reads all collected rows, not only the first ten', () => {
    const names = Array.from({ length: 44 }, (_, i) => `Skill ${i + 1}`);
    const html = `<main>${names.map((name, i) => row(i, name)).join('')}</main>`;
    expect(parseSkillsPage(html).skills).toEqual(names);
  });

  it('keeps the assessment badge from a later line', () => {
    const html = `<main>${row(1, 'Linux', 'Passed LinkedIn Skill Assessment')}${row(2, 'ITIL')}</main>`;
    expect(parseSkillsPage(html)).toEqual({ skills: ['Linux', 'ITIL'], assessed: ['Linux'] });
  });
});
