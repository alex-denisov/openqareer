import { describe, expect, it } from 'vitest';
import {
  extractSeniorityLevelFromPoint,
  extractVacancyRequirements,
  formatSeniorityLevel,
  isSeniorityLevel,
  LEVEL_HUMAN_NAMES,
  parseSeniorityLevel,
} from './vacancyLevel';

describe('vacancyLevel (D28)', () => {
  it('maps each level to human readable Russian name', () => {
    expect(LEVEL_HUMAN_NAMES.ic).toBe('Специалист');
    expect(LEVEL_HUMAN_NAMES.lead).toBe('Лид');
    expect(LEVEL_HUMAN_NAMES.head).toBe('Руководитель');
    expect(LEVEL_HUMAN_NAMES.vp).toBe('VP');
    expect(LEVEL_HUMAN_NAMES['c-level']).toBe('C-level');
  });

  it('parses and formats levels case-insensitively', () => {
    expect(parseSeniorityLevel('vp')).toBe('vp');
    expect(parseSeniorityLevel('VP')).toBe('vp');
    expect(parseSeniorityLevel('Lead')).toBe('lead');
    expect(parseSeniorityLevel('c-level')).toBe('c-level');
    expect(parseSeniorityLevel('C-LEVEL')).toBe('c-level');
    expect(parseSeniorityLevel('unknown-skill')).toBeUndefined();

    expect(isSeniorityLevel('vp')).toBe(true);
    expect(isSeniorityLevel('React')).toBe(false);

    expect(formatSeniorityLevel('vp')).toBe('VP');
    expect(formatSeniorityLevel('lead')).toBe('Лид');
    expect(formatSeniorityLevel('head')).toBe('Руководитель');
    expect(formatSeniorityLevel('ic')).toBe('Специалист');
    expect(formatSeniorityLevel('c-level')).toBe('C-level');
  });

  it('extracts seniority level from matching point strings', () => {
    expect(extractSeniorityLevelFromPoint('vp')).toBe('vp');
    expect(extractSeniorityLevelFromPoint('Подтверждённый навык: vp')).toBe('vp');
    expect(extractSeniorityLevelFromPoint('Подтверждённый навык: lead')).toBe('lead');
    expect(extractSeniorityLevelFromPoint('Подтверждённый навык: TypeScript')).toBeUndefined();
    expect(extractSeniorityLevelFromPoint('PostgreSQL')).toBeUndefined();
  });

  it('partitions skills and extracts vacancy level', () => {
    const result = extractVacancyRequirements(
      ['TypeScript', 'Подтверждённый навык: lead'],
      ['Kubernetes', 'vp'],
      ['Architecture'],
    );
    expect(result.skillMatching).toEqual(['TypeScript']);
    expect(result.skillMissing).toEqual(['Kubernetes']);
    expect(result.vacancyLevel).toBe('vp');
  });
});
