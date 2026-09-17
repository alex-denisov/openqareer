import { describe, expect, it } from 'vitest';
import { evidenceStatementLabel, unknownGroupLabel } from './resumeLabels';
import type { ResumeUnknownCode } from './resumeTypes';

const EVERY_CODE: ResumeUnknownCode[] = [
  'missing-full-name',
  'missing-contact',
  'missing-target-role',
  'missing-role-chronology',
  'missing-role-title',
  'missing-employer',
  'missing-role-start-date',
  'missing-role-end-date',
  'missing-role-claims',
  'missing-education',
  'missing-education-details',
  'missing-language-name',
  'missing-language-level',
  'chronology-conflict',
  'invalid-chronology-date',
  'ineligible-evidence',
  'germany-bullet-count',
  'germany-length-exceeds-two-pages',
];

describe('what the candidate is told instead of the internal code', () => {
  it('has a Russian label for every code the server can send', () => {
    for (const code of EVERY_CODE) {
      const label = unknownGroupLabel(code);
      expect(label.length).toBeGreaterThan(2);
      expect(label).not.toContain('-');
      expect(label).toMatch(/^[А-ЯЁ]/u);
    }
  });

  it('never leaks the code itself into the label', () => {
    expect(unknownGroupLabel('invalid-chronology-date')).not.toContain('invalid');
    expect(unknownGroupLabel('ineligible-evidence')).not.toContain('evidence');
  });
});

describe('what the candidate reads instead of an internal record number', () => {
  const memory = [
    { id: 'memory-42', statement: 'Сократила цикл поставки на 30%.' },
    { id: 'memory-77', statement: 'А'.repeat(120) },
  ];

  it('says the fact itself', () => {
    expect(evidenceStatementLabel(memory, 'memory-42', 'stale')).toBe(
      'Сократила цикл поставки на 30%.',
    );
  });

  it('shortens a long fact to 80 characters and marks the cut', () => {
    const label = evidenceStatementLabel(memory, 'memory-77', 'stale');
    expect(label).toHaveLength(81);
    expect(label.endsWith('…')).toBe(true);
  });

  it('never falls back to the internal number', () => {
    expect(evidenceStatementLabel(memory, 'memory-404', 'stale')).toBe(
      'Факт удалён',
    );
    expect(evidenceStatementLabel(memory, 'memory-404', 'excluded')).toBe(
      'Запись без текста',
    );
    expect(evidenceStatementLabel(memory, 'memory-404', 'stale')).not.toContain(
      'memory',
    );
  });
});

describe('resume format mode labels', () => {
  it('defines labels for all three canonical positioning formats', async () => {
    const { FORMAT_LABELS } = await import('./resumeLabels');
    expect(FORMAT_LABELS['stanford-pdf']).toBe('Stanford PDF');
    expect(FORMAT_LABELS['ats-text']).toBe('ATS Plain Text');
    expect(FORMAT_LABELS['linkedin-pack']).toBe('Профиль LinkedIn');
  });
});
