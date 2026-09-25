import { describe, expect, it } from 'vitest';
import { normalizeTitleKey } from './normalizeTitleKey';

describe('normalizeTitleKey (B267 S1)', () => {
  it('lower-cases and collapses whitespace', () => {
    expect(normalizeTitleKey('  Senior   Product Manager  ')).toBe('senior product manager');
  });

  it('strips the m/w/d gender marker in any bracket form', () => {
    expect(normalizeTitleKey('Product Manager (m/w/d)')).toBe('product manager');
    expect(normalizeTitleKey('Product Manager (w/m/d)')).toBe('product manager');
    expect(normalizeTitleKey('Менеджер по продажам (м/ж)')).toBe('менеджер по продажам');
  });

  it('strips a city named in brackets', () => {
    expect(normalizeTitleKey('Backend Developer (Berlin)')).toBe('backend developer');
  });

  it('strips remote/hybrid markers in RU and EN', () => {
    expect(normalizeTitleKey('Data Analyst Remote')).toBe('data analyst');
    expect(normalizeTitleKey('Data Analyst Hybrid')).toBe('data analyst');
    expect(normalizeTitleKey('Аналитик данных удалённо')).toBe('аналитик данных');
    expect(normalizeTitleKey('Аналитик данных удаленно')).toBe('аналитик данных');
  });

  it('drops a tail after " - " or " | " naming a city or company', () => {
    expect(normalizeTitleKey('Senior Engineer - Berlin')).toBe('senior engineer');
    expect(normalizeTitleKey('Sales Manager | Acme Corp')).toBe('sales manager');
  });

  it('strips numbers and stray #', () => {
    expect(normalizeTitleKey('Developer #2')).toBe('developer');
    expect(normalizeTitleKey('QA Engineer 3')).toBe('qa engineer');
  });

  it('treats RU and EN casing the same way for the same title', () => {
    const a = normalizeTitleKey('CHIEF TECHNOLOGY OFFICER');
    const b = normalizeTitleKey('Chief Technology Officer');
    expect(a).toBe(b);
    expect(a).toBe('chief technology officer');
  });

  it('collapses different surface forms to one key', () => {
    const withCity = normalizeTitleKey('Product Manager (m/w/d) - Berlin');
    const plain = normalizeTitleKey('Product Manager');
    expect(withCity).toBe(plain);
  });
});
