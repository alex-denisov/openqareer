import { describe, expect, it } from 'vitest';
import { normalizeResumeSourceText } from './resumeSourceText';

describe('normalizeResumeSourceText', () => {
  it('turns an inspector heading into a bare section line the parser can match', () => {
    expect(normalizeResumeSourceText('Contact\n\n## Experience\n- Led a team')).toBe(
      'Contact\n\nExperience\n- Led a team',
    );
  });

  it('drops the page-marker comments the inspector injects', () => {
    const normalized = normalizeResumeSourceText(
      '<!-- Page 1 -->\n\n# Contact\n\nalexey@example.com',
    );
    expect(normalized).not.toContain('<!--');
    expect(normalized).not.toContain('Page 1');
    expect(normalized).toContain('alexey@example.com');
  });

  it('keeps a bolded employer separated from the dash before it', () => {
    expect(
      normalizeResumeSourceText('Апрель 2023 —**АО "Россети Цифра"** Октябрь 2025'),
    ).toBe('Апрель 2023 — АО "Россети Цифра" Октябрь 2025');
  });

  it('reduces a markdown link to a usable address', () => {
    expect(
      normalizeResumeSourceText(
        '<u>[https://www.linkedin.com/in/e-tarasova/](https://www.linkedin.com/in/e-tarasova/)</u>',
      ),
    ).toBe('https://www.linkedin.com/in/e-tarasova/');
  });

  it('keeps both halves of a labelled link', () => {
    expect(normalizeResumeSourceText('[Портфолио](https://example.com/cv)')).toBe(
      'Портфолио (https://example.com/cv)',
    );
  });

  it('splits a skills table into one skill per line and drops the separator row', () => {
    const normalized = normalizeResumeSourceText(
      '||Project management VMware||\n|---|---|---|\n|Управление складом|SQL Server|',
    );
    expect(normalized.split('\n').filter(Boolean)).toEqual([
      'Project management VMware',
      'Управление складом',
      'SQL Server',
    ]);
  });

  it('decodes the html entities the inspector leaves behind', () => {
    expect(normalizeResumeSourceText('P&amp;L ownership &lt;scale&gt;')).toBe(
      'P&L ownership <scale>',
    );
  });

  it('normalises every bullet marker to a single dash', () => {
    expect(normalizeResumeSourceText('* One\n+ Two\n- Three')).toBe(
      '- One\n- Two\n- Three',
    );
  });

  it('leaves an underscore inside a handle alone', () => {
    expect(normalizeResumeSourceText('telegram: @marina_orlova')).toBe(
      'telegram: @marina_orlova',
    );
  });

  it('collapses runs of blank lines to a single separator', () => {
    expect(normalizeResumeSourceText('A\n\n\n\nB')).toBe('A\n\nB');
  });

  it('returns plain text unchanged apart from trimming', () => {
    expect(normalizeResumeSourceText('  Marina Orlova\nCTO  ')).toBe(
      'Marina Orlova\nCTO',
    );
  });
});
